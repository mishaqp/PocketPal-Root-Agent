#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
app_path = root / "App.tsx"
sidebar_path = root / "src/components/SidebarContent/SidebarContent.tsx"

app = app_path.read_text(encoding="utf-8")
sidebar = sidebar_path.read_text(encoding="utf-8")

# Register the Root Agent home screen directly from the overlay. Keep this
# separate from src/screens/index.ts so the overlay does not need to replace
# upstream's screen barrel file.
needle = "import {OnboardingStack} from './src/screens/OnboardingScreens';\n"
addition = needle + "import {RootAgentHomeScreen} from './src/screens/RootAgentHomeScreen';\n"
if addition not in app:
    if needle not in app:
        raise SystemExit("App.tsx onboarding import anchor not found")
    app = app.replace(needle, addition, 1)

# Make Agent Home the first/default drawer route while preserving all existing
# PocketPal screens during the gradual UI migration.
needle = """                          <Drawer.Screen\n                            name={ROUTES.CHAT}\n                            component={gestureHandlerRootHOC(ChatScreen)}\n"""
addition = """                          <Drawer.Screen\n                            name=\"RootAgent\"\n                            component={gestureHandlerRootHOC(RootAgentHomeScreen)}\n                            options={{\n                              headerStyle: styles.headerWithoutDivider,\n                              title: 'Root Agent',\n                            }}\n                          />\n                          <Drawer.Screen\n                            name={ROUTES.CHAT}\n                            component={gestureHandlerRootHOC(ChatScreen)}\n"""
if addition not in app:
    if needle not in app:
        raise SystemExit("App.tsx Chat drawer anchor not found")
    app = app.replace(needle, addition, 1)

# Add a lightweight drawer entry without replacing SidebarContent wholesale.
# This keeps upstream chat/session behavior intact and limits merge conflicts.
needle = """          <Drawer.Section showDivider={false}>\n            <Drawer.Item\n              label={l10n.components.sidebarContent.menuItems.chat}\n"""
addition = """          <Drawer.Section showDivider={false}>\n            <Drawer.Item\n              label=\"Agent\"\n              onPress={() => props.navigation.navigate('RootAgent')}\n              style={styles.menuDrawerItem}\n              testID=\"drawer-item-root-agent\"\n            />\n            <Drawer.Item\n              label={l10n.components.sidebarContent.menuItems.chat}\n"""
if addition not in sidebar:
    if needle not in sidebar:
        raise SystemExit("SidebarContent main menu anchor not found")
    sidebar = sidebar.replace(needle, addition, 1)

app_path.write_text(app, encoding="utf-8")
sidebar_path.write_text(sidebar, encoding="utf-8")
print("Applied Root Agent home screen navigation + drawer entry")
