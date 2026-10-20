package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBuildSettingTree(t *testing.T) {
	groups := []settingGroup{
		{Name: "Host Information", Group: "Info"},
		{Name: "Users & Groups", Group: "Users"},
		{Name: "Developer Options", Group: "Advance"},
	}
	mods := []settingModule{
		{Name: "Host Info", Group: "Info"},
		{Name: "Runtime", Group: "Info", RequireAdmin: true},
		{Name: "My Account", Group: "Users"},
		{Name: "System Log", Group: "Advance", RequireAdmin: true},
		{Name: "Orphan", Group: "Unknown"},
	}

	names := func(tree []settingGroupTree) map[string][]string {
		out := map[string][]string{}
		for _, g := range tree {
			for _, m := range g.Modules {
				out[g.Group] = append(out[g.Group], m.Name)
			}
		}
		return out
	}

	tests := []struct {
		name       string
		isAdmin    bool
		wantGroups []string
		wantPages  map[string][]string
	}{
		{
			name:       "admin sees every page in registration order",
			isAdmin:    true,
			wantGroups: []string{"Info", "Users", "Advance"},
			wantPages: map[string][]string{
				"Info":    {"Host Info", "Runtime"},
				"Users":   {"My Account"},
				"Advance": {"System Log"},
			},
		},
		{
			name:       "user loses admin pages and groups left empty",
			isAdmin:    false,
			wantGroups: []string{"Info", "Users"},
			wantPages: map[string][]string{
				"Info":  {"Host Info"},
				"Users": {"My Account"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tree := buildSettingTree(groups, mods, tt.isAdmin)
			gotGroups := []string{}
			for _, g := range tree {
				gotGroups = append(gotGroups, g.Group)
			}
			if !reflect.DeepEqual(gotGroups, tt.wantGroups) {
				t.Errorf("groups = %v, want %v", gotGroups, tt.wantGroups)
			}
			if got := names(tree); !reflect.DeepEqual(got, tt.wantPages) {
				t.Errorf("pages = %v, want %v", got, tt.wantPages)
			}
		})
	}
}

func TestBuildSettingTreeEmptyAndJSON(t *testing.T) {
	tree := buildSettingTree(nil, nil, true)
	if tree == nil || len(tree) != 0 {
		t.Fatalf("expected an empty, non-nil tree, got %#v", tree)
	}

	tree = buildSettingTree(
		[]settingGroup{{Name: "Host Information", Group: "Info", IconPath: "a.svg"}},
		[]settingModule{{Name: "Host Info", Group: "Info", StartDir: "SystemAO/info/index.html"}},
		false,
	)
	js, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("marshal tree: %v", err)
	}
	var decoded []map[string]interface{}
	if err := json.Unmarshal(js, &decoded); err != nil {
		t.Fatalf("unmarshal tree: %v", err)
	}
	if len(decoded) != 1 {
		t.Fatalf("expected one group, got %d", len(decoded))
	}
	for _, key := range []string{"Name", "Group", "IconPath", "Modules"} {
		if _, ok := decoded[0][key]; !ok {
			t.Errorf("group JSON is missing %q: %s", key, js)
		}
	}
}
