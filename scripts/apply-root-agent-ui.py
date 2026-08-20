#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
app_path = root / "App.tsx"
sidebar_path = root / "src/components/SidebarContent/SidebarContent.tsx"
runtime_path = root / "src/services/rootAgent/RootAgentRuntimeStore.ts"

app = app_path.read_text(encoding="utf-8")
sidebar = sidebar_path.read_text(encoding="utf-8")
runtime = runtime_path.read_text(encoding="utf-8")

# Register Root Agent screens directly from the overlay. Keep this separate from
# src/screens/index.ts so the overlay does not replace upstream's screen barrel.
needle = "import {OnboardingStack} from './src/screens/OnboardingScreens';\n"
addition = (
    needle
    + "import {RootAgentHomeScreen} from './src/screens/RootAgentHomeScreen';\n"
    + "import {DiagnosticsScreen} from './src/screens/DiagnosticsScreen';\n"
)
if addition not in app:
    if needle not in app:
        raise SystemExit("App.tsx onboarding import anchor not found")
    app = app.replace(needle, addition, 1)

# Diagnostics are opt-in, not the app landing page. Keep Chat as the explicit
# default so neither Agent Home nor log capture UI pops up on every launch.
needle = """                        <Drawer.Navigator
                          screenOptions={{
"""
replacement = """                        <Drawer.Navigator
                          initialRouteName={ROUTES.CHAT}
                          screenOptions={{
"""
if replacement not in app:
    if needle not in app:
        raise SystemExit("App.tsx Drawer.Navigator anchor not found")
    app = app.replace(needle, replacement, 1)

# Register Agent Home + Logs while preserving existing PocketPal screens.
needle = """                          <Drawer.Screen
                            name={ROUTES.CHAT}
                            component={gestureHandlerRootHOC(ChatScreen)}
"""
addition = """                          <Drawer.Screen
                            name=\"RootAgent\"
                            component={gestureHandlerRootHOC(RootAgentHomeScreen)}
                            options={{
                              headerStyle: styles.headerWithoutDivider,
                              title: 'Root Agent',
                            }}
                          />
                          <Drawer.Screen
                            name=\"RootAgentDiagnostics\"
                            component={gestureHandlerRootHOC(DiagnosticsScreen)}
                            options={{
                              headerStyle: styles.headerWithoutDivider,
                              title: 'Логи Root Agent',
                            }}
                          />
                          <Drawer.Screen
                            name={ROUTES.CHAT}
                            component={gestureHandlerRootHOC(ChatScreen)}
"""
if addition not in app:
    if needle not in app:
        raise SystemExit("App.tsx Chat drawer anchor not found")
    app = app.replace(needle, addition, 1)

# Add dedicated opt-in Agent + Logs items without replacing SidebarContent.
needle = """          <Drawer.Section showDivider={false}>
            <Drawer.Item
              label={l10n.components.sidebarContent.menuItems.chat}
"""
addition = """          <Drawer.Section showDivider={false}>
            <Drawer.Item
              label=\"Agent\"
              icon=\"robot-outline\"
              onPress={() => props.navigation.navigate('RootAgent')}
              style={styles.menuDrawerItem}
              testID=\"drawer-item-root-agent\"
            />
            <Drawer.Item
              label=\"Логи агента\"
              icon=\"file-document-outline\"
              onPress={() => props.navigation.navigate('RootAgentDiagnostics')}
              style={styles.menuDrawerItem}
              testID=\"drawer-item-root-agent-diagnostics\"
            />
            <Drawer.Item
              label={l10n.components.sidebarContent.menuItems.chat}
"""
if addition not in sidebar:
    if needle not in sidebar:
        raise SystemExit("SidebarContent main menu anchor not found")
    sidebar = sidebar.replace(needle, addition, 1)

# PRoot-Distro's machine-readable list mode prints only installed container
# names, one per line. The previous human-readable parser could miss Debian and
# incorrectly mark Linux as DEGRADED even though linux_exec worked.
old = """      const distroList = await termuxControl.runCommand('proot-distro', ['list'], {
        timeoutMs: 30_000,
      });
"""
new = """      const distroList = await termuxControl.runCommand(
        'proot-distro',
        ['list', '--quiet'],
        {timeoutMs: 30_000},
      );
"""
if new not in runtime:
    if old not in runtime:
        raise SystemExit("RootAgentRuntimeStore proot-distro list anchor not found")
    runtime = runtime.replace(old, new, 1)

app_path.write_text(app, encoding="utf-8")
sidebar_path.write_text(sidebar, encoding="utf-8")
runtime_path.write_text(runtime, encoding="utf-8")
print("Applied opt-in Root Agent + diagnostics navigation and Linux detection fix")
