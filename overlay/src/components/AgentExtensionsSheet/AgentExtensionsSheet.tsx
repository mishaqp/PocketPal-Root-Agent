import React, {useContext, useEffect, useState} from 'react';
import {Alert, Platform, StyleSheet, View} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import {observer} from 'mobx-react-lite';
import {Button, IconButton, Switch, Text} from 'react-native-paper';

import {Sheet, TextInput} from '..';
import {L10nContext} from '../../utils';
import {extensionStore} from '../../store/ExtensionStore';
import {
  parsePluginManifest,
  parseSkillMarkdown,
} from '../../services/extensions/importers';

interface Props {
  isVisible: boolean;
  onDismiss: () => void;
}

async function pickTextFile(): Promise<{name: string; content: string} | null> {
  try {
    const result = await pick({
      type: Platform.OS === 'ios' ? 'public.data' : [types.allFiles],
    });
    const file = result[0];
    if (!file?.uri) {
      return null;
    }
    return {
      name: file.name || 'Imported extension',
      content: await RNFS.readFile(file.uri, 'utf8'),
    };
  } catch (error) {
    if (
      isErrorWithCode(error) &&
      error.code === errorCodes.OPERATION_CANCELED
    ) {
      return null;
    }
    throw error;
  }
}

export const AgentExtensionsSheet: React.FC<Props> = observer(
  ({isVisible, onDismiss}) => {
    const l10n = useContext(L10nContext);
    const copy = (l10n.settings as any).agentExtensions;
    const [memory, setMemory] = useState(extensionStore.globalMemory);

    useEffect(() => {
      if (isVisible) {
        setMemory(extensionStore.globalMemory);
      }
    }, [isVisible]);

    const importSkill = async () => {
      try {
        const file = await pickTextFile();
        if (!file) {
          return;
        }
        const fallback = file.name.replace(/\.md$/i, '');
        await extensionStore.installSkill(
          parseSkillMarkdown(file.content, fallback),
        );
        Alert.alert(copy.skillImportedTitle, copy.skillImportedMessage);
      } catch (error) {
        Alert.alert(copy.importErrorTitle, String(error));
      }
    };

    const importPlugin = async () => {
      try {
        const file = await pickTextFile();
        if (!file) {
          return;
        }
        await extensionStore.installPlugin(parsePluginManifest(file.content));
        Alert.alert(copy.pluginImportedTitle, copy.pluginImportedMessage);
      } catch (error) {
        Alert.alert(copy.importErrorTitle, String(error));
      }
    };

    return (
      <Sheet
        isVisible={isVisible}
        onClose={onDismiss}
        title={copy.title}
        snapPoints={['92%']}>
        <Sheet.ScrollView contentContainerStyle={styles.container}>
          <Text variant="titleMedium">{copy.memoryTitle}</Text>
          <Text variant="bodySmall" style={styles.description}>
            {copy.memoryDescription}
          </Text>
          <TextInput
            testID="agent-global-memory-input"
            value={memory}
            onChangeText={setMemory}
            multiline
            numberOfLines={6}
            maxLength={8000}
            placeholder={copy.memoryPlaceholder}
          />
          <Button
            testID="agent-global-memory-save"
            mode="contained"
            style={styles.button}
            onPress={() => extensionStore.setGlobalMemory(memory)}>
            {copy.saveMemory}
          </Button>

          <View style={styles.sectionHeader}>
            <View style={styles.sectionText}>
              <Text variant="titleMedium">{copy.skillsTitle}</Text>
              <Text variant="bodySmall" style={styles.description}>
                {copy.skillsDescription}
              </Text>
            </View>
            <Button mode="outlined" compact onPress={importSkill}>
              {copy.importSkill}
            </Button>
          </View>
          {extensionStore.skills.length === 0 && (
            <Text style={styles.empty}>{copy.noSkills}</Text>
          )}
          {extensionStore.skills.map(skill => (
            <View key={skill.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text variant="titleSmall">{skill.name}</Text>
                {!!skill.description && (
                  <Text variant="bodySmall" style={styles.description}>
                    {skill.description}
                  </Text>
                )}
              </View>
              <Switch
                value={skill.enabled}
                onValueChange={enabled =>
                  extensionStore.setSkillEnabled(skill.id, enabled)
                }
              />
              <IconButton
                icon="delete-outline"
                onPress={() => extensionStore.removeSkill(skill.id)}
              />
            </View>
          ))}

          <View style={styles.sectionHeader}>
            <View style={styles.sectionText}>
              <Text variant="titleMedium">{copy.pluginsTitle}</Text>
              <Text variant="bodySmall" style={styles.description}>
                {copy.pluginsDescription}
              </Text>
            </View>
            <Button mode="outlined" compact onPress={importPlugin}>
              {copy.importPlugin}
            </Button>
          </View>
          {extensionStore.plugins.length === 0 && (
            <Text style={styles.empty}>{copy.noPlugins}</Text>
          )}
          {extensionStore.plugins.map(plugin => (
            <View key={plugin.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text variant="titleSmall">{plugin.name}</Text>
                <Text variant="bodySmall" style={styles.description}>
                  {plugin.description || plugin.talents.join(', ')}
                </Text>
              </View>
              <Switch
                value={plugin.enabled}
                onValueChange={enabled =>
                  extensionStore.setPluginEnabled(plugin.id, enabled)
                }
              />
              <IconButton
                icon="delete-outline"
                onPress={() => extensionStore.removePlugin(plugin.id)}
              />
            </View>
          ))}

          <Text variant="bodySmall" style={styles.securityNote}>
            {copy.securityNote}
          </Text>
        </Sheet.ScrollView>
      </Sheet>
    );
  },
);

const styles = StyleSheet.create({
  container: {padding: 16, paddingBottom: 40},
  description: {opacity: 0.72, marginTop: 3},
  button: {marginTop: 10, alignSelf: 'flex-start'},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
    marginBottom: 8,
  },
  sectionText: {flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  rowText: {flex: 1, paddingRight: 8},
  empty: {opacity: 0.6, paddingVertical: 12},
  securityNote: {opacity: 0.72, marginTop: 24, marginBottom: 12},
});

