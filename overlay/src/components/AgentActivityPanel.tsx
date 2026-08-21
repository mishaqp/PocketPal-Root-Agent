import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {useTheme} from '../hooks';
import {chatSessionStore} from '../store';
import {taskCheckpointStore} from '../services/taskCheckpoint/TaskCheckpointStore';
import type {TaskCheckpoint} from '../services/taskCheckpoint/TaskCheckpointStore';

const ACTIVE_STATUSES = new Set([
  'prefill',
  'streaming_text',
  'generating_tool_call',
  'executing_tool',
]);

const checkpointIsOpen = (checkpoint?: TaskCheckpoint): boolean =>
  checkpoint?.status === 'active' || checkpoint?.status === 'interrupted';

const statusLabel = (
  status: string,
  toolName?: string,
  interrupted?: boolean,
): string => {
  if (interrupted) return 'Задача приостановлена';
  switch (status) {
    case 'prefill':
      return 'Готовит следующий шаг';
    case 'streaming_text':
      return 'Формирует ответ';
    case 'generating_tool_call':
      return toolName ? `Готовит ${toolName}` : 'Готовит действие';
    case 'executing_tool':
      return toolName ? `Выполняет ${toolName}` : 'Выполняет действие';
    case 'done':
      return 'Задача завершена';
    case 'failed':
      return 'Ошибка выполнения';
    default:
      return 'Root Agent';
  }
};

const statusIcon = (status: string, interrupted?: boolean): string => {
  if (interrupted) return 'pause-circle-outline';
  switch (status) {
    case 'done':
      return 'check-circle-outline';
    case 'failed':
      return 'alert-circle-outline';
    case 'executing_tool':
      return 'tools';
    case 'generating_tool_call':
      return 'cog-outline';
    default:
      return 'robot-outline';
  }
};

export const AgentActivityPanel = observer(() => {
  const theme = useTheme();
  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        shell: {
          marginHorizontal: 12,
          marginTop: 8,
          marginBottom: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.outline,
          borderRadius: 14,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        header: {
          minHeight: 48,
          paddingLeft: 12,
          paddingRight: 6,
          flexDirection: 'row',
          alignItems: 'center',
        },
        headerText: {
          flex: 1,
          marginLeft: 10,
        },
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        title: {
          flexShrink: 1,
          fontWeight: '700',
          color: theme.colors.onSurface,
        },
        progress: {
          marginLeft: 8,
          color: theme.colors.primary,
          fontWeight: '700',
        },
        subtitle: {
          marginTop: 1,
          color: theme.colors.onSurfaceVariant,
        },
        closeButton: {
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 18,
        },
        body: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.outlineVariant ?? theme.colors.outline,
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 12,
        },
        row: {
          marginBottom: 8,
        },
        label: {
          color: theme.colors.onSurfaceVariant,
          marginBottom: 2,
        },
        value: {
          color: theme.colors.onSurface,
        },
        error: {
          color: theme.colors.error,
        },
        hint: {
          marginTop: 2,
          color: theme.colors.onSurfaceVariant,
        },
      }),
    [theme],
  );

  const sessionId = chatSessionStore.activeSessionId;
  const agentStatus = chatSessionStore.agentUiState.status;
  const pendingTalentNames = chatSessionStore.agentUiState.pendingTalentNames;
  const isGenerating = chatSessionStore.isGenerating;

  const [checkpoint, setCheckpoint] = React.useState<TaskCheckpoint>();
  const [expanded, setExpanded] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [lastObservedTool, setLastObservedTool] = React.useState('');
  const wasGenerating = React.useRef(false);

  const refreshCheckpoint = React.useCallback(async () => {
    await taskCheckpointStore.ensureHydrated();
    setCheckpoint(
      sessionId ? taskCheckpointStore.getForSession(sessionId) : undefined,
    );
  }, [sessionId]);

  React.useEffect(() => {
    void refreshCheckpoint();
  }, [refreshCheckpoint, agentStatus, isGenerating]);

  // Checkpoint writes happen after tool results. Poll only while an agent run is
  // active so the progress line can advance without making the checkpoint store
  // a UI-specific MobX dependency.
  React.useEffect(() => {
    if (!isGenerating) return;
    const timer = setInterval(() => void refreshCheckpoint(), 700);
    return () => clearInterval(timer);
  }, [isGenerating, refreshCheckpoint]);

  React.useEffect(() => {
    const current = pendingTalentNames.find(Boolean);
    if (current) setLastObservedTool(current);
  }, [pendingTalentNames]);

  // A user-dismissed panel stays hidden for the current run, but every new send
  // gets a fresh panel automatically. Follow-up tool turns do not reopen it.
  React.useEffect(() => {
    if (isGenerating && !wasGenerating.current) {
      setDismissed(false);
      setExpanded(false);
      setLastObservedTool('');
    }
    wasGenerating.current = isGenerating;
  }, [isGenerating]);

  React.useEffect(() => {
    setDismissed(false);
    setExpanded(false);
    setLastObservedTool('');
  }, [sessionId]);

  const interrupted = checkpoint?.status === 'interrupted';
  const openCheckpoint = checkpointIsOpen(checkpoint);
  const shouldShow =
    ACTIVE_STATUSES.has(agentStatus) ||
    agentStatus === 'done' ||
    agentStatus === 'failed' ||
    openCheckpoint;

  if (!shouldShow || dismissed) return null;

  const toolName =
    pendingTalentNames.find(Boolean) ||
    lastObservedTool ||
    checkpoint?.lastToolName ||
    undefined;
  const progress = checkpoint?.totalSteps
    ? `${checkpoint.step}/${checkpoint.totalSteps}`
    : checkpoint && checkpoint.step > 0
      ? `шаг ${checkpoint.step}`
      : undefined;
  const subtitle = statusLabel(agentStatus, toolName, interrupted);
  const taskTitle = checkpoint?.task || 'Текущая задача Root Agent';

  return (
    <View style={styles.shell} testID="agent-activity-panel">
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(value => !value)}
        accessibilityRole="button"
        accessibilityLabel="Показать действия Root Agent">
        <Icon
          name={statusIcon(agentStatus, interrupted)}
          size={22}
          color={
            agentStatus === 'failed' || interrupted
              ? theme.colors.error
              : theme.colors.primary
          }
        />
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text variant="titleSmall" style={styles.title} numberOfLines={1}>
              Root Agent
            </Text>
            {progress ? (
              <Text variant="labelMedium" style={styles.progress}>
                {progress}
              </Text>
            ) : null}
          </View>
          <Text variant="bodySmall" style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={theme.colors.onSurfaceVariant}
        />
        <Pressable
          style={styles.closeButton}
          onPress={event => {
            event.stopPropagation();
            setDismissed(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Скрыть панель Root Agent">
          <Icon name="close" size={20} color={theme.colors.onSurfaceVariant} />
        </Pressable>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          <View style={styles.row}>
            <Text variant="labelSmall" style={styles.label}>
              Задача
            </Text>
            <Text variant="bodyMedium" style={styles.value} numberOfLines={2}>
              {taskTitle}
            </Text>
          </View>

          <View style={styles.row}>
            <Text variant="labelSmall" style={styles.label}>
              Сейчас
            </Text>
            <Text variant="bodyMedium" style={styles.value} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>

          {toolName ? (
            <View style={styles.row}>
              <Text variant="labelSmall" style={styles.label}>
                Инструмент
              </Text>
              <Text variant="bodyMedium" style={styles.value} numberOfLines={1}>
                {toolName}
              </Text>
            </View>
          ) : null}

          {checkpoint?.nextAction ? (
            <View style={styles.row}>
              <Text variant="labelSmall" style={styles.label}>
                Следующий шаг
              </Text>
              <Text variant="bodySmall" style={styles.value} numberOfLines={3}>
                {checkpoint.nextAction}
              </Text>
            </View>
          ) : null}

          {checkpoint?.lastError ? (
            <View style={styles.row}>
              <Text variant="labelSmall" style={styles.label}>
                Последняя ошибка
              </Text>
              <Text variant="bodySmall" style={styles.error} numberOfLines={3}>
                {checkpoint.lastError}
              </Text>
            </View>
          ) : null}

          <Text variant="labelSmall" style={styles.hint}>
            ✕ скрывает панель, но не останавливает выполняемую задачу.
          </Text>
        </View>
      ) : null}
    </View>
  );
});
