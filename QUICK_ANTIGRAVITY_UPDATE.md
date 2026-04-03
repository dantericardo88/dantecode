# ⚡ Quick Antigravity Update (Fast Method)

The full packaging takes too long (8+ GB extension). Here's a **much faster way** to use your fixes in Antigravity!

---

## ✅ Quick Method (2 minutes instead of 20+)

### **Option 1: Use Extension Development Mode** ⭐ **RECOMMENDED**

This runs DanteCode directly from source - **instant updates**, no packaging needed!

**Steps:**

1. **Build packages** (if not already done):
   ```bash
   cd C:\Projects\DanteCode
   npm run build --workspaces
   ```

2. **In Antigravity/VSCode:**
   - Press `F5` (or Run → Start Debugging)
   - A new "Extension Development Host" window opens
   - This window has DanteCode with **all your fixes** ✅

3. **Use it normally:**
   - Open your project in the Extension Development Host window
   - All 4 bug fixes are active
   - Changes to source code reload automatically

**Shortcut:**
- Double-click: `C:\Projects\DanteCode\quick-update-antigravity.bat`
- Then press F5 in Antigravity

---

### **Option 2: Command Line Development Mode**

```bash
cd C:\Projects\DanteCode
code --extensionDevelopmentPath="C:\Projects\DanteCode\packages\vscode" .
```

This opens Antigravity with the extension loaded from source.

---

## 🎯 Why This Is Better

| Method | Time | Pros | Cons |
|--------|------|------|------|
| **Full packaging** | 20+ min | Production-ready .vsix | Very slow, huge file |
| **Development Mode** ⭐ | 2 min | Instant, auto-reload | Need to press F5 |
| **Command line** | 1 min | One command | Need to remember path |

---

## ✅ Verify Your Fixes Work

After opening Extension Development Host, test:

### **Test 1: cd commands**
```bash
# Should work or suggest alternative
cd frontend && npm install
```

### **Test 2: Error messages**
```bash
# Should show specific, helpful errors
(Try malformed JSON)
```

### **Test 3: No false warnings**
```bash
# Should allow planning without warnings
(Read 4-5 files before writing)
```

### **Test 4: Command suggestions**
```bash
# Should suggest alternatives
(Try blocked cd command)
```

---

## 🔄 Daily Workflow

**Morning:** 
```bash
cd C:\Projects\DanteCode
git pull
npm run build --workspaces
```

**Working:**
- Open Antigravity
- Press F5
- Use Extension Development Host for all work

**After changes:**
- Edit source code
- Extension reloads automatically
- Test immediately

---

## 📦 When to Use Full Packaging

Only package when you need to:
- Share extension with others
- Install on different machine
- Deploy to marketplace
- Create production build

For daily use, **Development Mode is faster and better**!

---

## 🚀 Quick Commands

```bash
# Build everything
npm run build --workspaces

# Link CLI
cd packages/cli && npm link

# Open in dev mode
code --extensionDevelopmentPath="C:\Projects\DanteCode\packages\vscode" .

# Or just press F5 in Antigravity!
```

---

## ✅ Your 4 Fixes (Active in Dev Mode)

✅ Fix 1: cd commands work  
✅ Fix 2: Clear error messages  
✅ Fix 3: No false warnings  
✅ Fix 4: Command suggestions  

**All active immediately in Extension Development Host!** 🎉

---

## 💡 Pro Tip

Add to VSCode launch.json:
```json
{
  "type": "extensionHost",
  "request": "launch",
  "name": "DanteCode Dev",
  "runtimeExecutable": "${execPath}",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode"
  ]
}
```

Then just click "Run" in the sidebar!
