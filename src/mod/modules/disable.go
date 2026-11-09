package modules

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	Disabled modules

	An admin can switch a module off without removing its files. A disabled
	module stays registered on a separate list (DisabledModule), so it can be
	listed and switched on again, but it is gone from LoadedModule: users do
	not see it, cannot launch it or boot into it, and the files and backend
	scripts of a folder whose modules are all disabled are refused.

	The names are kept in the "module" table as "disabled/<name>", so the
	choice survives a restart: RegisterModule puts a disabled module straight
	onto the disabled list when its init.agi runs at boot.
*/

const disabledKeyPrefix = "disabled/"

// StateStore is where the disabled module names are kept, normally the
// system database. The "module" table must exist.
type StateStore interface {
	Write(tableName string, key string, value interface{}) error
	Delete(tableName string, key string) error
	ListTable(tableName string) ([][][]byte, error)
}

// disabledState is the part of the handler the router reads on every request
type disabledState struct {
	mu      sync.RWMutex
	names   map[string]bool //lowercased names of the disabled modules
	folders map[string]bool //lowercased source folders with no enabled module left
}

// LoadDisabledModules reads the disabled module names from the store. Call it
// before the modules register, so a disabled one never shows up at boot.
func (m *ModuleHandler) LoadDisabledModules(store StateStore) error {
	m.stateStore = store
	entries, err := store.ListTable("module")
	if err != nil {
		return err
	}
	names := map[string]bool{}
	for _, entry := range entries {
		key := string(entry[0])
		if !strings.HasPrefix(key, disabledKeyPrefix) {
			continue
		}
		disabled := false
		if json.Unmarshal(entry[1], &disabled) == nil && disabled {
			names[strings.ToLower(strings.TrimPrefix(key, disabledKeyPrefix))] = true
		}
	}
	m.disabled.mu.Lock()
	m.disabled.names = names
	m.disabled.mu.Unlock()
	m.refreshDisabledFolders()
	return nil
}

// IsModuleDisabled reports whether an admin switched this module off
func (m *ModuleHandler) IsModuleDisabled(moduleName string) bool {
	m.disabled.mu.RLock()
	defer m.disabled.mu.RUnlock()
	return m.disabled.names[strings.ToLower(moduleName)]
}

// IsSourceFolderDisabled reports whether every module registered from this
// folder (e.g. "web/Setup Wizard") is disabled. A folder that registered no
// module at all, such as SystemAO or script, is never disabled.
func (m *ModuleHandler) IsSourceFolderDisabled(folder string) bool {
	if folder == "" {
		return false
	}
	folder = strings.ToLower(filepath.ToSlash(filepath.Clean(folder)))
	m.disabled.mu.RLock()
	defer m.disabled.mu.RUnlock()
	return m.disabled.folders[folder]
}

// CanDisableModule tells whether this module may be switched off, and why not.
// The system settings, the system tools and the desktop (the interface every
// account falls back to) always stay on, as does any module that a permission
// group still boots into.
func (m *ModuleHandler) CanDisableModule(module *ModuleInfo) error {
	if module == nil {
		return errors.New("Module not exists")
	}
	if isProtectedModule(module) {
		return errors.New("System modules cannot be disabled")
	}
	if m.InterfaceModuleUsers != nil {
		if groups := m.InterfaceModuleUsers(module.Name); len(groups) == 1 {
			return errors.New("The " + groups[0] + " group opens this module after signing in. Change the interface module of that group first")
		} else if len(groups) > 1 {
			sort.Strings(groups)
			return errors.New("The " + strings.Join(groups, ", ") + " groups open this module after signing in. Change their interface module first")
		}
	}
	return nil
}

func isProtectedModule(module *ModuleInfo) bool {
	return module.Name == "System Setting" || module.Name == "Desktop" || strings.EqualFold(module.Group, "System Tools")
}

// SetModuleEnabled switches a module on or off and saves the choice
func (m *ModuleHandler) SetModuleEnabled(moduleName string, enabled bool) error {
	if enabled {
		return m.enableModule(moduleName)
	}
	return m.disableModule(moduleName)
}

func (m *ModuleHandler) disableModule(moduleName string) error {
	var target *ModuleInfo
	remaining := []*ModuleInfo{}
	for _, module := range m.LoadedModule {
		if module.Name == moduleName && target == nil {
			target = module
			continue
		}
		remaining = append(remaining, module)
	}
	if target == nil {
		if m.IsModuleDisabled(moduleName) {
			return nil
		}
		return errors.New("Module not exists")
	}
	if err := m.CanDisableModule(target); err != nil {
		return err
	}
	if err := m.saveDisabled(moduleName, true); err != nil {
		return err
	}

	m.LoadedModule = remaining
	m.DisabledModule = append(m.DisabledModule, target)
	m.removeUniversalModule(target.Name)
	m.setDisabledName(moduleName, true) //also refreshes the folders, after the move
	logger.PrintAndLog("Modules", "Module disabled: "+moduleName, nil)
	return nil
}

func (m *ModuleHandler) enableModule(moduleName string) error {
	var target *ModuleInfo
	remaining := []*ModuleInfo{}
	for _, module := range m.DisabledModule {
		if module.Name == moduleName && target == nil {
			target = module
			continue
		}
		remaining = append(remaining, module)
	}
	if target == nil && !m.IsModuleDisabled(moduleName) {
		if m.GetModuleInfoByID(moduleName) != nil {
			//Already on
			return nil
		}
		return errors.New("Module not exists")
	}
	if err := m.saveDisabled(moduleName, false); err != nil {
		return err
	}
	m.setDisabledName(moduleName, false)

	if target != nil {
		m.DisabledModule = remaining
		m.LoadedModule = append(m.LoadedModule, target)
		m.ModuleSortList()
		if IsUniversalGroup(target.Group) && m.userHandler != nil {
			m.userHandler.UniversalModules = append(m.userHandler.UniversalModules, target.Name)
		}
		m.refreshDisabledFolders()
	}
	logger.PrintAndLog("Modules", "Module enabled: "+moduleName, nil)
	return nil
}

// saveDisabled writes the choice. Without a store it lasts until a restart.
func (m *ModuleHandler) saveDisabled(moduleName string, disabled bool) error {
	if m.stateStore == nil {
		return nil
	}
	key := disabledKeyPrefix + moduleName
	if disabled {
		return m.stateStore.Write("module", key, true)
	}
	return m.stateStore.Delete("module", key)
}

func (m *ModuleHandler) setDisabledName(moduleName string, disabled bool) {
	m.disabled.mu.Lock()
	if m.disabled.names == nil {
		m.disabled.names = map[string]bool{}
	}
	if disabled {
		m.disabled.names[strings.ToLower(moduleName)] = true
	} else {
		delete(m.disabled.names, strings.ToLower(moduleName))
	}
	m.disabled.mu.Unlock()
	m.refreshDisabledFolders()
}

// forgetDisabled drops a removed module from the disabled list and the store
func (m *ModuleHandler) forgetDisabled(moduleName string) {
	if !m.IsModuleDisabled(moduleName) {
		return
	}
	if err := m.saveDisabled(moduleName, false); err != nil {
		logger.PrintAndLog("Modules", "Could not clear the disabled flag of "+moduleName, err)
	}
	remaining := []*ModuleInfo{}
	for _, module := range m.DisabledModule {
		if module.Name != moduleName {
			remaining = append(remaining, module)
		}
	}
	m.DisabledModule = remaining
	m.setDisabledName(moduleName, false)
}

// refreshDisabledFolders works out which source folders have no enabled
// module left. Office/ registers three apps: it is only closed once all three
// are off.
func (m *ModuleHandler) refreshDisabledFolders() {
	enabled := map[string]bool{}
	for _, module := range m.LoadedModule {
		if module.SourceFolder != "" {
			enabled[strings.ToLower(module.SourceFolder)] = true
		}
	}
	folders := map[string]bool{}
	for _, module := range m.DisabledModule {
		folder := strings.ToLower(module.SourceFolder)
		if folder != "" && !enabled[folder] {
			folders[folder] = true
		}
	}
	m.disabled.mu.Lock()
	m.disabled.folders = folders
	m.disabled.mu.Unlock()
}

func (m *ModuleHandler) removeUniversalModule(moduleName string) {
	if m.userHandler == nil {
		return
	}
	remaining := []string{}
	for _, name := range m.userHandler.UniversalModules {
		if name != moduleName {
			remaining = append(remaining, name)
		}
	}
	m.userHandler.UniversalModules = remaining
}

// HandleSetModuleEnabled switches a module on or off (admin only).
// POST module=<name>&enabled=true|false
func (m *ModuleHandler) HandleSetModuleEnabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "This request must be a POST")
		return
	}
	moduleName, err := utils.PostPara(r, "module")
	if err != nil || strings.TrimSpace(moduleName) == "" {
		utils.SendErrorResponse(w, "Invalid module name")
		return
	}
	enabled, err := utils.PostBool(r, "enabled")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid enabled state")
		return
	}
	if err := m.SetModuleEnabled(moduleName, enabled); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
