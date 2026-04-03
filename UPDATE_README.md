# 🔄 DanteCode Universal Update Guide

This guide shows you how to update **all DanteCode installations** on your PC at once.

---

## ✅ One-Command Update (Recommended)

### **For Windows (PowerShell or CMD):**

```powershell
# From any directory
cd C:\Projects\DanteCode
.\update-all-versions.ps1
```

### **For Mac/Linux/WSL (Bash):**

```bash
# From any directory
cd /c/Projects/DanteCode
./update-all-versions.sh
```

### **Or use npm script:**

```bash
cd C:\Projects\DanteCode
npm run update-all
```

---

## 📦 What Gets Updated

The update script automatically updates:

1. ✅ **CLI Tool (global)**
   - Rebuilds `@dantecode/cli`
   - Links globally via `npm link`
   - Available as `dantecode` command everywhere

2. ✅ **VSCode/Antigravity Extension**
   - Rebuilds `packages/vscode`
   - Packages as `.vsix` file
   - Uninstalls old version
   - Installs new version with all your fixes

3. ✅ **Desktop App** (if present)
   - Rebuilds `packages/desktop`
   - Ready to launch with `npm start`

---

## 🔍 What the Script Does

### Step-by-Step Process:

1. **Checks git status** - Offers to commit uncommitted changes
2. **Builds all packages** - Runs `npm run build --workspaces`
3. **Runs tests** - Verifies everything works (continues even if some fail)
4. **Updates CLI** - Links global `dantecode` command
5. **Packages VSCode extension** - Creates `.vsix` with latest code
6. **Uninstalls old extension** - Removes previous versions
7. **Installs new extension** - Installs fresh `.vsix` with your fixes
8. **Updates Desktop** - Rebuilds desktop app (if exists)

**Total time**: ~2-3 minutes

---

## 🚀 After Running Update

### **Important: Reload VSCode/Antigravity**

1. **Close ALL VSCode/Antigravity windows**
2. **Reopen VSCode/Antigravity**
3. **Press** `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
4. **Type**: `Developer: Reload Window`
5. **Press Enter**

This ensures the new extension is fully loaded.

---

## ✅ Verify Updates

### **Check CLI Version:**
```bash
dantecode --version
```

### **Check VSCode Extension:**
```bash
code --list-extensions --show-versions | grep dante
```

Should show: `dantecode.dantecode@0.9.2` or higher

### **Check in Antigravity:**
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "DanteCode"
3. You should see DanteCode commands available

---

## 🔧 Your Recent Fixes Included

After updating, all 4 critical bug fixes will be active:

### ✅ **Fix 1: cd Command Support**
```bash
# BEFORE (blocked):
cd frontend && npm install  ❌

# AFTER (works or suggests alternative):
cd frontend && npm install  ✅
# Or suggests: npm --prefix frontend install
```

### ✅ **Fix 2: Better Error Messages**
```bash
# BEFORE (vague):
❌ "Malformed tool blocks"

# AFTER (specific):
✅ "Parse Error at position 42: Unescaped quote
   Common fixes:
   • Use \" inside strings
   • Use \\ for paths"
```

### ✅ **Fix 3: No False Warnings**
```bash
# BEFORE:
⚠️ "Anti-confabulation (2/4)" during normal planning

# AFTER:
✅ Grace period allows planning reads without warnings
```

### ✅ **Fix 4: Command Suggestions**
```bash
# BEFORE:
❌ "Error: Run from repository root" (no help)

# AFTER:
✅ "Error: cd blocked
   Suggested: npm --prefix frontend install
   💡 Explanation: runs from repo root"
```

---

## 🆘 Troubleshooting

### **Problem: "vsce not found"**
**Solution**: Script auto-installs it, but you can manually install:
```bash
npm install -g @vscode/vsce
```

### **Problem: "Permission denied"**
**Solution**: Run PowerShell as Administrator (Windows) or use `sudo` (Mac/Linux)

### **Problem: Extension not updating**
**Solution**:
1. Completely close VSCode/Antigravity
2. Manually uninstall:
   ```bash
   code --uninstall-extension dantecode.dantecode
   ```
3. Delete extension folder:
   ```bash
   rm -rf ~/.vscode/extensions/dantecode.dantecode-*
   ```
4. Run update script again

### **Problem: CLI command not found**
**Solution**: Reload your shell or open a new terminal

### **Problem: "npm link failed"**
**Solution**: You may need to run as administrator or with sudo

---

## 📝 Manual Update (If Script Fails)

If the automatic script doesn't work, you can update manually:

### **1. Build Packages**
```bash
cd C:\Projects\DanteCode
npm run build --workspaces --if-present
```

### **2. Update CLI**
```bash
cd packages/cli
npm link
```

### **3. Update VSCode Extension**
```bash
cd packages/vscode
npm run package
code --uninstall-extension dantecode.dantecode
code --install-extension dantecode-0.9.2.vsix
```

### **4. Reload VSCode**
Close all windows, reopen, and run "Developer: Reload Window"

---

## 🎯 Quick Reference

| Command | Purpose |
|---------|---------|
| `.\update-all-versions.ps1` | Update everything (Windows) |
| `./update-all-versions.sh` | Update everything (Mac/Linux/WSL) |
| `npm run update-all` | Update everything (cross-platform) |
| `dantecode --version` | Check CLI version |
| `code --list-extensions` | Check installed extensions |

---

## 💡 Tips

- **Run regularly**: Update after pulling new changes from git
- **Before testing**: Always update before testing new features
- **After fixes**: Update immediately after fixing bugs (like you just did!)
- **Share with team**: Other developers can use same script

---

## 📚 Related Documentation

- [FIXES_COMPLETE_NEXT_STEPS.md](./FIXES_COMPLETE_NEXT_STEPS.md) - Your 4 bug fixes explained
- [CRITICAL_README_INSTALL_FIXES.md](./CRITICAL_README_INSTALL_FIXES.md) - Installation troubleshooting
- [UPR.md](./UPR.md) - Complete bug analysis and fixes

---

## ✅ Success!

After running the update script:

✅ All your bug fixes are now active across all installations  
✅ CLI, VSCode, and Desktop all use the same fixed code  
✅ No more "fake work" from cd command blocking  
✅ Better error messages for faster debugging  
✅ No false anti-confabulation warnings  
✅ Helpful command translation suggestions  

**You're ready to use the fixed DanteCode in Antigravity!** 🎉
