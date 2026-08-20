import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {Button, Card, Divider, Text} from 'react-native-paper';

import {useTheme} from '../hooks';
import {
  diagnosticsControl,
  DiagnosticsExport,
  DiagnosticsStatus,
} from '../services/diagnostics/DiagnosticsControl';
import {rootAgentRuntimeStore} from '../services/rootAgent';
import {Theme} from '../utils/types';

const formatTime = (value?: number | null): string => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const formatSize = (bytes?: number): string => {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const DiagnosticsScreen = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const runtime = rootAgentRuntimeStore;
  const [status, setStatus] = React.useState<DiagnosticsStatus>({
    active: false,
    startedAt: null,
    lastExport: '',
  });
  const [lastExport, setLastExport] = React.useState<DiagnosticsExport | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await diagnosticsControl.getStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const begin = React.useCallback(async () => {
    setBusy(true);
    setError('');
    setLastExport(null);
    try {
      setStatus(await diagnosticsControl.startCapture());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = React.useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await diagnosticsControl.clearCapture());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const exportLogs = React.useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const checkpoint = runtime.agent.checkpoint;
      const snapshot = {
        exportedAt: Date.now(),
        overallStatus: runtime.overallStatus,
        android: {
          status: runtime.android.status,
          rootAvailable: runtime.android.rootAvailable,
          rootCommandWorked: runtime.android.rootCommandWorked,
          rootIdentity: runtime.android.rootIdentity,
          model: runtime.android.model,
          androidVersion: runtime.android.androidVersion,
          lastCheckedAt: runtime.android.lastCheckedAt,
          error: runtime.android.error,
        },
        termux: {...runtime.termux},
        linux: {...runtime.linux},
        agent: {
          status: runtime.agent.status,
          lastError: runtime.agent.lastError,
          checkpoint: checkpoint
            ? {
                status: checkpoint.status,
                step: checkpoint.step,
                totalSteps: checkpoint.totalSteps,
                lastToolName: checkpoint.lastToolName,
                lastError: checkpoint.lastError,
                updatedAt: checkpoint.updatedAt,
              }
            : null,
        },
        selfTest: {...runtime.selfTest},
        problems: runtime.problems,
      };
      const result = await diagnosticsControl.exportBundle(snapshot);
      setLastExport(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh, runtime]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="root-agent-diagnostics-screen">
      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <Text variant="headlineSmall" style={styles.title}>
            Логи Root Agent
          </Text>
          <Text variant="bodyMedium" style={styles.muted}>
            Начни запись перед воспроизведением проблемы. После ошибки вернись
            сюда и экспортируй ZIP — он будет сохранён в
            Download/RootAgentLogs.
          </Text>

          <Divider style={styles.divider} />

          <View style={styles.row}>
            <Text variant="bodyLarge">Состояние</Text>
            <Text
              variant="labelLarge"
              style={{
                color: status.active
                  ? theme.colors.primary
                  : theme.colors.onSurfaceVariant,
              }}>
              {status.active ? '● ЗАПИСЬ' : 'ОСТАНОВЛЕНО'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text variant="bodyMedium">Начало</Text>
            <Text variant="bodySmall" style={styles.muted}>
              {formatTime(status.startedAt)}
            </Text>
          </View>
          {status.lastExport ? (
            <View style={styles.row}>
              <Text variant="bodyMedium">Последний ZIP</Text>
              <Text
                variant="bodySmall"
                style={[styles.muted, styles.filename]}
                numberOfLines={2}>
                {status.lastExport}
              </Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <View style={styles.actions}>
        <Button
          mode="contained"
          onPress={begin}
          disabled={busy || status.active}
          testID="diagnostics-start-button">
          Начать сбор логов
        </Button>
        <Button
          mode="contained-tonal"
          onPress={exportLogs}
          loading={busy && status.active}
          disabled={busy || !status.active}
          testID="diagnostics-export-button">
          Остановить и экспортировать ZIP
        </Button>
        <Button
          mode="outlined"
          onPress={clear}
          disabled={busy || !status.active}
          testID="diagnostics-clear-button">
          Остановить без экспорта
        </Button>
      </View>

      {lastExport ? (
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium">ZIP готов ✓</Text>
            <Text variant="bodyMedium" style={styles.exportName}>
              {lastExport.fileName}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              Размер: {formatSize(lastExport.sizeBytes)}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              Папка: Download/RootAgentLogs
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {error ? (
        <Card mode="outlined" style={styles.errorCard}>
          <Card.Content>
            <Text variant="titleSmall" style={{color: theme.colors.error}}>
              Ошибка сборщика
            </Text>
            <Text variant="bodySmall" style={{color: theme.colors.error}}>
              {error}
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      <Card mode="outlined" style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium">Что попадает в архив</Text>
          <Text variant="bodyMedium" style={styles.item}>
            • logcat от начала записи до экспорта, отфильтрованный по Root Agent
            и его PID
          </Text>
          <Text variant="bodyMedium" style={styles.item}>
            • AndroidRuntime/ActivityManager строки, относящиеся к пакету
            приложения
          </Text>
          <Text variant="bodyMedium" style={styles.item}>
            • package, appops, services и meminfo только для Root Agent
          </Text>
          <Text variant="bodyMedium" style={styles.item}>
            • состояние ZeroTermux-пакета для диагностики RUN_COMMAND
          </Text>
          <Text variant="bodyMedium" style={styles.item}>
            • снимок Android/Termux/Linux/runtime/checkpoint без текста чата
          </Text>

          <Divider style={styles.divider} />

          <Text variant="bodySmall" style={styles.muted}>
            Перед сохранением маскируются типичные API-ключи, Bearer-токены,
            access/refresh tokens и пароли. Сборщик не выгружает базы данных,
            приватные файлы приложения, буфер обмена или хранилища учётных
            данных.
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
    },
    card: {
      marginBottom: 14,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    errorCard: {
      marginBottom: 14,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.error,
    },
    title: {
      fontWeight: '700',
      marginBottom: 6,
    },
    muted: {
      color: theme.colors.onSurfaceVariant,
    },
    divider: {
      marginVertical: 14,
    },
    row: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    filename: {
      flex: 1,
      textAlign: 'right',
    },
    actions: {
      gap: 10,
      marginBottom: 14,
    },
    exportName: {
      marginTop: 6,
      marginBottom: 4,
    },
    item: {
      marginTop: 8,
      color: theme.colors.onSurface,
    },
  });
