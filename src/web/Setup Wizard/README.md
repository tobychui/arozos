# Setup Wizard

The first-run guide of a new ArozOS installation. The administrator group of a
new installation boots into this interface module instead of the desktop, so
the first admin is walked through setting up their server right after they
create their account and sign in.

## How it starts and stops

- `permission.NewPermissionHandler` creates the `administrator` group on a new
  installation with `interfaceModule/administrator = "Setup Wizard"`
  (`permission.SetupWizardModule`). Installations whose administrator group
  already exists keep their interface.
- `/` sends the admin to the wizard like any interface module
  (`main.router.go`). If the wizard is removed or disabled while a group still
  boots into it, `/` falls back to the desktop.
- **Finish** and **Skip** both call `POST /system/setup/finish` with the
  workspace to use (Skip on a first run uses the desktop, Skip on a re-run keeps
  the admin's current one). It sets that interface on every group that boots
  into the wizard (or on `administrator` when none does), clears the saved
  progress and disables this module.
- To run it again, an admin switches it on in System Settings > Add & Remove
  Module and presses Open. Interface modules are not listed in the start menu.

A disabled WebApp is not served: requests for its files are answered by
`serveDisabledModuleFolder` (this folder redirects to `/`, images stay
reachable for the module manager), and its AGI scripts are refused. See
`mod/modules/disable.go`.

## Steps

| Step | What it does | Endpoints |
|---|---|---|
| Welcome | What the guide covers, language picker | |
| Workspace | Desktop or Drive (other interface modules listed below them) | applied on finish |
| Storage | Lists disks (Linux), formats a disk nothing uses, mounts a partition at `/media/<id>` or uses one the host already mounts; any platform can add a folder | `system/setup/disks`, `system/setup/disk/format`, `system/setup/disk/add`, `system/storage/pool/{test,edit,removeHandler}` |
| Network drives | Optional SMB / WebDAV / SFTP / FTP / S3 drive, with a connection test | `system/storage/pool/{test,edit}` |
| People | Just me, everyone an administrator, or a limited group (apps, quota, workspace) | `system/permission/{newgroup,editgroup}` |
| Accounts | Only when others use the server: creates accounts, sets who may use the drives added in the guide | `system/auth/register`, `system/storage/access` |
| File sharing | Built-in SMB server (or Samba), WebDAV, SFTP; the SMB password of the admin | `system/network/server/{toggle,endpoints}`, `system/storage/smb/{status,activate}` |
| Finish | Summary, then finish | `system/setup/finish` |

`system/setup/state` returns everything the wizard shows in one read, and
`system/setup/progress` saves the step and the choices (never a password), so a
closed tab resumes where it was. All `system/setup/*` endpoints are admin only
(`src/setupwizard.go`).

## Look

Swiss (International Typographic Style) layout in a macOS-like window
(`css/wizard.css`, all colours are tokens on `:root` with a dark set):

- On a desktop the wizard is a rounded window floating on a neutral backdrop,
  with 32px around it (16px below 1100px); below 860px it fills the screen and
  the step list becomes a progress bar.
- Content sits flush left on one column (840px including padding); the
  navigation buttons line up with that column's right edge.
- Each step opens with a numbered eyebrow (`03  STORAGE`, the number in signal
  red, added by `core.js`), one large tight headline and a lead paragraph.
  Sections are separated by hairline rules with small uppercase labels.
- No shadows or coloured tiles inside the window: choices are hairline cards
  whose selection is a black (white in dark mode) outline, notes are a rule on
  the left, forms sit on a grey group like macOS settings.
- Controls follow macOS: 7px radius push buttons, blue focus rings, blue
  switches and checkboxes, a HUD toast and a sheet for the format dialog.
- The workspace previews are grey wireframes with one red accent, inverted in
  dark mode.

## Usernames

Account names are checked by `auth.ValidateUsername`, which
`AuthAgent.CreateUserAccount` runs for every way an account is made (register
endpoint, CSV import, public sign-up, LDAP, AGI `createUser`): letters of any
script and digits, then also `. - _ @`, at most 64 characters, no spaces, path
separators, `..` or Windows device names. The accounts step checks the same
rule in the browser first.

## Disk safety

The disk logic is in `src/mod/setupwizard/` (`disks.go` portable, `disks_linux.go`
runs `lsblk`, `mkfs.*` and prepares the mount folder).

- Formatting is Linux only, needs ArozOS to run as root with hardware
  management on, and needs the admin's password again.
- A disk may only be formatted when nothing on it is in use: no partition is
  mounted, holds swap, RAID, LVM or LUKS, or backs an ArozOS drive (by device,
  partition UUID or path, including the folder ArozOS runs from). The check runs
  again on a fresh `lsblk` listing right before `mkfs`.
- A disk with partitions is formatted per partition; only a disk without a
  partition table is formatted whole.
- A mount that fails quietly is caught (`fs.CheckMounted`) and the drive is
  removed again, so files never land in the empty `/media/<id>` folder.

## Files

- `init.agi` registers the module (`Group: "Interface Module"`).
- `js/core.js` holds the state, step list, navigation, server calls and dialogs;
  each `js/step.*.js` registers one step (see the comment at the top of
  `core.js`).
- `js/icons.js` holds the line icons, `img/` the module icon and the two
  workspace previews.
- `locale/setup_wizard.json` has every string in File Manager's six languages
  (zh-hk is the same as zh-tw). Strings are looked up with `Wizard.T(key,
  englishFallback, vars)`.
