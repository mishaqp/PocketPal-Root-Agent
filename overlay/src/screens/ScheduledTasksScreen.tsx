import React from 'react';
import {Alert, ScrollView, StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {
  Button,
  Card,
  Divider,
  Snackbar,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';

import {useTheme} from '../hooks';
import {modelStore} from '../store';
import {scheduledAgentControl} from '../services/scheduledAgent/ScheduledAgentControl';
import {
  scheduledAgentStore,
  ScheduledAgentTask,
} from '../services/scheduledAgent/ScheduledAgentStore';
import {ModelOrigin, Theme} from '../utils/types';

const pad = (value: number): string => String(value).padStart(2, '0');

const defaultFixedTime = (): string => {
  const value = new Date(Date.now() + 30 * 60_000);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate(),
  )}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

const formatTime = (value?: number): string => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return new Date(value).toString();
  }
};

const statusText = (task: ScheduledAgentTask): string => {
  if (!task.enabled) return 'ОТКЛЮЧЕНА';
  switch (task.status) {
    case 'running':
      return 'ВЫПОЛНЯЕТСЯ';
    case 'failed':
      return 'ОШИБКА';
    case 'completed':
      return 'ГОТОВО';
    default:
      return 'ЗАПЛАНИРОВАНА';
  }
};

export const ScheduledTasksScreen = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);

  const [tasks, setTasks] = React.useState<ScheduledAgentTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [exactAlarmAllowed, setExactAlarmAllowed] = React.useState<
    boolean | null
  >(null);
  const [notificationsEnabled, setNotificationsEnabled] = React.useState<
    boolean | null
  >(null);

  const [title, setTitle] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [scheduleKind, setScheduleKind] = React.useState<'delay' | 'fixed'>(
    'delay',
  );
  const [delayMinutes, setDelayMinutes] = React.useState('5');
  const [fixedTime, setFixedTime] = React.useState(defaultFixedTime);
  const [repeatDaily, setRepeatDaily] = React.useState(false);
  const [actionMode, setActionMode] = React.useState(false);
  const [allowReboot, setAllowReboot] = React.useState(false);
  const [notify, setNotify] = React.useState(true);

  const activeModel = modelStore.activeModel;
  const remoteModelReady = activeModel?.origin === ModelOrigin.REMOTE;
  const activeModelLabel = activeModel
    ? ((activeModel as any).name || activeModel.id)
    : 'не выбрана';

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [items, status] = await Promise.all([
        scheduledAgentStore.list(),
        scheduledAgentControl.getStatus(),
      ]);
      setTasks(items);
      setExactAlarmAllowed(status.exactAlarmAllowed);
      setNotificationsEnabled(status.notificationsEnabled);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const resolveTriggerAt = (): number => {
    if (scheduleKind === 'delay') {
      const minutes = Number(delayMinutes.trim());
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
        throw new Error('Укажи задержку от 1 до 525600 минут.');
      }
      return Date.now() + Math.trunc(minutes) * 60_000;
    }

    const parsed = new Date(fixedTime.trim()).getTime();
    if (!Number.isFinite(parsed)) {
      throw new Error('Дата должна быть в формате 2026-08-21T18:30.');
    }
    if (parsed < Date.now() - 60_000) {
      throw new Error('Нельзя создать задачу в прошлом.');
    }
    return parsed;
  };

  const createTask = async () => {
    if (!remoteModelReady || !activeModel) {
      setMessage('Сначала выбери API/remote модель в чате.');
      return;
    }
    if (!title.trim() || !prompt.trim()) {
      setMessage('Заполни название и инструкцию задачи.');
      return;
    }

    setCreating(true);
    try {
      const created = await scheduledAgentStore.create({
        title: title.trim(),
        prompt: prompt.trim(),
        modelId: activeModel.id,
        triggerAtMs: resolveTriggerAt(),
        repeatDaily,
        mode: actionMode ? 'action' : 'read_only',
        allowReboot: actionMode && allowReboot,
        notify,
      });
      setTitle('');
      setPrompt('');
      setMessage(
        created.native.exact
          ? 'Задача создана. Точный будильник активен.'
          : 'Задача создана. Android может немного сдвинуть время запуска.',
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const runNow = async (task: ScheduledAgentTask) => {
    setBusyTaskId(task.id);
    try {
      await scheduledAgentStore.runNow(task.id);
      setMessage(`Запуск «${task.title}» отправлен агенту.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTaskId(null);
    }
  };

  const disableTask = async (task: ScheduledAgentTask) => {
    setBusyTaskId(task.id);
    try {
      await scheduledAgentStore.disable(task.id);
      setMessage(`«${task.title}» отключена.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyTaskId(null);
    }
  };

  const removeTask = (task: ScheduledAgentTask) => {
    Alert.alert(
      'Удалить задачу?',
      task.title,
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyTaskId(task.id);
              try {
                await scheduledAgentStore.remove(task.id);
                setMessage(`«${task.title}» удалена.`);
                await refresh();
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setBusyTaskId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="scheduled-tasks-screen">
        <Card mode="outlined" style={styles.heroCard}>
          <Card.Content>
            <Text variant="headlineSmall" style={styles.heroTitle}>
              SCHEDULED TASKS
            </Text>
            <Text variant="bodyMedium" style={styles.muted}>
              Агент может проснуться по времени, выполнить сохранённую инструкцию
              через API-модель и записать результат.
            </Text>
            <Divider style={styles.divider} />
            <Text variant="bodySmall" style={styles.muted}>
              API-модель: {activeModelLabel}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              Точный AlarmManager:{' '}
              {exactAlarmAllowed === null
                ? 'проверяется'
                : exactAlarmAllowed
                  ? 'доступен'
                  : 'нет, возможен сдвиг времени'}
            </Text>
            <Text variant="bodySmall" style={styles.muted}>
              Уведомления:{' '}
              {notificationsEnabled === null
                ? 'проверяются'
                : notificationsEnabled
                  ? 'разрешены'
                  : 'отключены системой'}
            </Text>
          </Card.Content>
        </Card>

        <Text variant="titleMedium" style={styles.sectionTitle}>
          НОВАЯ ЗАДАЧА
        </Text>
        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <TextInput
              mode="outlined"
              label="Название"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              style={styles.input}
            />
            <TextInput
              mode="outlined"
              label="Что должен сделать агент"
              value={prompt}
              onChangeText={setPrompt}
              multiline
              maxLength={6000}
              style={styles.input}
            />

            <View style={styles.modeButtons}>
              <Button
                mode={scheduleKind === 'delay' ? 'contained' : 'outlined'}
                onPress={() => setScheduleKind('delay')}
                style={styles.halfButton}>
                Через N минут
              </Button>
              <Button
                mode={scheduleKind === 'fixed' ? 'contained' : 'outlined'}
                onPress={() => setScheduleKind('fixed')}
                style={styles.halfButton}>
                Дата / время
              </Button>
            </View>

            {scheduleKind === 'delay' ? (
              <TextInput
                mode="outlined"
                label="Через сколько минут"
                value={delayMinutes}
                onChangeText={setDelayMinutes}
                keyboardType="number-pad"
                style={styles.input}
              />
            ) : (
              <TextInput
                mode="outlined"
                label="Локальное время"
                value={fixedTime}
                onChangeText={setFixedTime}
                placeholder="2026-08-21T18:30"
                style={styles.input}
              />
            )}

            <SwitchRow
              label="Повторять ежедневно"
              value={repeatDaily}
              onValueChange={setRepeatDaily}
              styles={styles}
            />
            <SwitchRow
              label="Разрешить изменения на телефоне"
              value={actionMode}
              onValueChange={value => {
                setActionMode(value);
                if (!value) setAllowReboot(false);
              }}
              styles={styles}
            />
            {actionMode ? (
              <SwitchRow
                label="Разрешить перезагрузку"
                value={allowReboot}
                onValueChange={setAllowReboot}
                styles={styles}
              />
            ) : null}
            <SwitchRow
              label="Уведомить о результате"
              value={notify}
              onValueChange={setNotify}
              styles={styles}
            />

            {!remoteModelReady ? (
              <Text variant="bodySmall" style={styles.warning}>
                Для фонового запуска нужна выбранная API/remote модель.
              </Text>
            ) : null}

            <Button
              mode="contained"
              onPress={() => void createTask()}
              loading={creating}
              disabled={creating || !remoteModelReady}
              style={styles.primaryButton}
              testID="scheduled-task-create-button">
              Создать задачу
            </Button>
          </Card.Content>
        </Card>

        <View style={styles.sectionHeader}>
          <Text variant="titleMedium" style={styles.sectionTitleInline}>
            ЗАДАЧИ ({tasks.length})
          </Text>
          <Button mode="text" onPress={() => void refresh()} loading={loading}>
            Обновить
          </Button>
        </View>

        {!loading && tasks.length === 0 ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Content>
              <Text variant="bodyMedium" style={styles.muted}>
                Пока задач нет. Создай первую выше или попроси агента сделать это
                через tool scheduled_agent.
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        {tasks.map(task => {
          const busy = busyTaskId === task.id;
          const history = task.history ?? [];
          return (
            <Card key={task.id} mode="outlined" style={styles.taskCard}>
              <Card.Content>
                <View style={styles.taskHeader}>
                  <View style={styles.taskTitleBlock}>
                    <Text variant="titleMedium" style={styles.taskTitle}>
                      {task.title}
                    </Text>
                    <Text variant="labelMedium" style={styles.statusLabel}>
                      {statusText(task)}
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={styles.mutedRight}>
                    {task.mode === 'action' ? 'ACTION' : 'READ ONLY'}
                  </Text>
                </View>

                <Text
                  variant="bodyMedium"
                  style={styles.promptText}
                  numberOfLines={4}>
                  {task.prompt}
                </Text>
                <Divider style={styles.divider} />
                <MetaRow
                  label="Следующий запуск"
                  value={formatTime(task.nextRunAt ?? task.triggerAtMs)}
                  styles={styles}
                />
                <MetaRow
                  label="Повтор"
                  value={task.repeatDaily ? 'ежедневно' : 'один раз'}
                  styles={styles}
                />
                <MetaRow
                  label="Последний запуск"
                  value={formatTime(task.lastRunAt)}
                  styles={styles}
                />

                {task.lastError ? (
                  <Text variant="bodySmall" style={styles.errorText}>
                    Последняя ошибка: {task.lastError}
                  </Text>
                ) : task.lastResult ? (
                  <Text
                    variant="bodySmall"
                    style={styles.resultText}
                    numberOfLines={5}>
                    Последний результат: {task.lastResult}
                  </Text>
                ) : null}

                {history.length > 0 ? (
                  <View style={styles.historyBlock}>
                    <Text variant="labelLarge" style={styles.historyTitle}>
                      Журнал выполнения
                    </Text>
                    {history.slice(0, 3).map((entry, index) => (
                      <View
                        key={`${entry.finishedAt}-${index}`}
                        style={styles.historyEntry}>
                        <Text
                          variant="bodySmall"
                          style={entry.success ? styles.muted : styles.errorText}>
                          {entry.success ? '✓' : '×'} {formatTime(entry.finishedAt)}
                        </Text>
                        <Text
                          variant="bodySmall"
                          style={styles.muted}
                          numberOfLines={3}>
                          {entry.result}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.taskActions}>
                  <Button
                    mode="outlined"
                    compact
                    disabled={busy || !task.enabled}
                    loading={busy && task.status === 'running'}
                    onPress={() => void runNow(task)}>
                    Запустить
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    disabled={busy || !task.enabled}
                    onPress={() => void disableTask(task)}>
                    Отключить
                  </Button>
                  <Button
                    mode="text"
                    compact
                    textColor={theme.colors.error}
                    disabled={busy}
                    onPress={() => removeTask(task)}>
                    Удалить
                  </Button>
                </View>
              </Card.Content>
            </Card>
          );
        })}
      </ScrollView>

      <Snackbar
        visible={!!message}
        onDismiss={() => setMessage('')}
        duration={4500}>
        {message}
      </Snackbar>
    </View>
  );
});

type SwitchRowProps = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  styles: ReturnType<typeof createStyles>;
};

const SwitchRow: React.FC<SwitchRowProps> = ({
  label,
  value,
  onValueChange,
  styles,
}) => (
  <View style={styles.switchRow}>
    <Text variant="bodyMedium" style={styles.switchLabel}>
      {label}
    </Text>
    <Switch value={value} onValueChange={onValueChange} />
  </View>
);

type MetaRowProps = {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
};

const MetaRow: React.FC<MetaRowProps> = ({label, value, styles}) => (
  <View style={styles.metaRow}>
    <Text variant="bodySmall" style={styles.muted}>
      {label}
    </Text>
    <Text variant="bodySmall" style={styles.metaValue}>
      {value}
    </Text>
  </View>
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 40,
    },
    heroCard: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    taskCard: {
      marginBottom: 12,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    heroTitle: {
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginBottom: 6,
    },
    sectionTitle: {
      marginTop: 22,
      marginBottom: 8,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    sectionHeader: {
      marginTop: 18,
      marginBottom: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionTitleInline: {
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    divider: {
      marginVertical: 12,
    },
    input: {
      marginBottom: 12,
      backgroundColor: theme.colors.surface,
    },
    modeButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    halfButton: {
      width: '48%',
    },
    switchRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    switchLabel: {
      flex: 1,
      paddingRight: 12,
      color: theme.colors.onSurface,
    },
    warning: {
      marginTop: 8,
      color: theme.colors.error,
    },
    primaryButton: {
      marginTop: 14,
    },
    muted: {
      color: theme.colors.onSurfaceVariant,
    },
    mutedRight: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'right',
    },
    taskHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    taskTitleBlock: {
      flex: 1,
      paddingRight: 12,
    },
    taskTitle: {
      color: theme.colors.onSurface,
      fontWeight: '700',
    },
    statusLabel: {
      marginTop: 2,
      color: theme.colors.primary,
      fontWeight: '700',
    },
    promptText: {
      marginTop: 10,
      color: theme.colors.onSurface,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginVertical: 3,
    },
    metaValue: {
      flex: 1,
      marginLeft: 16,
      color: theme.colors.onSurface,
      textAlign: 'right',
    },
    errorText: {
      marginTop: 10,
      color: theme.colors.error,
    },
    resultText: {
      marginTop: 10,
      color: theme.colors.onSurfaceVariant,
    },
    historyBlock: {
      marginTop: 12,
    },
    historyTitle: {
      color: theme.colors.onSurface,
      marginBottom: 6,
      fontWeight: '700',
    },
    historyEntry: {
      paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outline,
    },
    taskActions: {
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
  });
