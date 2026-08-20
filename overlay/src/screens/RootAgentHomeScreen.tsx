import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {Button, Card, Divider, Text} from 'react-native-paper';

import {useTheme} from '../hooks';
import {chatSessionStore} from '../store';
import {
  rootAgentRuntimeStore,
  RuntimeReadiness,
} from '../services/rootAgent';
import {Theme} from '../utils/types';

const statusLabel = (status: RuntimeReadiness): string => {
  switch (status) {
    case 'ready':
      return 'READY';
    case 'checking':
      return 'CHECKING';
    case 'degraded':
      return 'DEGRADED';
    case 'error':
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
};

const statusGlyph = (status: RuntimeReadiness): string => {
  switch (status) {
    case 'ready':
      return '✓';
    case 'checking':
      return '…';
    case 'degraded':
      return '!';
    case 'error':
      return '×';
    default:
      return '•';
  }
};

const formatCheckedAt = (value?: number): string => {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return new Date(value).toLocaleTimeString();
  }
};

const extractSelinuxContext = (identity: string): string => {
  const match = identity.match(/context=([^\s]+)/i);
  return match?.[1] || '—';
};

type StatusRowProps = {
  label: string;
  status: RuntimeReadiness;
  detail?: string;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
};

const StatusRow: React.FC<StatusRowProps> = ({
  label,
  status,
  detail,
  theme,
  styles,
}) => {
  const color =
    status === 'error'
      ? theme.colors.error
      : status === 'ready'
        ? theme.colors.primary
        : status === 'checking'
          ? theme.colors.secondary
          : theme.colors.outline;

  return (
    <View style={styles.statusRow}>
      <View style={styles.statusRowMain}>
        <Text style={[styles.statusGlyph, {color}]}>{statusGlyph(status)}</Text>
        <View style={styles.statusTextBlock}>
          <Text variant="bodyLarge" style={styles.rowLabel}>
            {label}
          </Text>
          {detail ? (
            <Text
              variant="bodySmall"
              style={styles.rowDetail}
              numberOfLines={2}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      <Text variant="labelMedium" style={[styles.statusText, {color}]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
};

export const RootAgentHomeScreen = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const runtime = rootAgentRuntimeStore;
  const checking = runtime.selfTest.status === 'checking';
  const checkpoint = runtime.agent.checkpoint;

  const refreshPassive = React.useCallback(() => {
    void runtime.startupSelfTest(chatSessionStore.activeSessionId ?? undefined);
  }, [runtime]);

  const runDeepSelfTest = React.useCallback(() => {
    void runtime.deepSelfTest();
  }, [runtime]);

  const agentReadiness: RuntimeReadiness =
    runtime.agent.status === 'error'
      ? 'error'
      : runtime.agent.status === 'interrupted'
        ? 'degraded'
        : runtime.agent.status === 'running'
          ? 'checking'
          : 'ready';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="root-agent-home-screen">
      <Card style={styles.heroCard} mode="outlined">
        <Card.Content>
          <View style={styles.heroHeader}>
            <View style={styles.heroTextBlock}>
              <Text variant="headlineSmall" style={styles.heroTitle}>
                ROOT AGENT
              </Text>
              <Text variant="bodyMedium" style={styles.heroSubtitle}>
                Android + Termux + Linux runtime
              </Text>
            </View>
            <View style={styles.heroStatus}>
              <Text
                variant="titleMedium"
                style={[
                  styles.heroStatusText,
                  {
                    color:
                      runtime.overallStatus === 'error'
                        ? theme.colors.error
                        : runtime.overallStatus === 'ready'
                          ? theme.colors.primary
                          : theme.colors.outline,
                  },
                ]}>
                {statusGlyph(runtime.overallStatus)}{' '}
                {statusLabel(runtime.overallStatus)}
              </Text>
            </View>
          </View>

          <Divider style={styles.heroDivider} />

          <Text variant="bodySmall" style={styles.heroMeta}>
            Last check: {formatCheckedAt(runtime.selfTest.lastCompletedAt)}
            {'  •  '}Foreground recoveries:{' '}
            {runtime.termux.foregroundRecoveryCount}
          </Text>
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        SYSTEM
      </Text>
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <StatusRow
            label="Android Root"
            status={runtime.android.status}
            detail={
              runtime.android.rootCommandWorked
                ? 'Real uid=0 root probe verified'
                : runtime.android.error || 'Waiting for root probe'
            }
            theme={theme}
            styles={styles}
          />
          <Divider />
          <StatusRow
            label="Device"
            status={runtime.android.model ? runtime.android.status : 'unknown'}
            detail={
              runtime.android.model
                ? `${runtime.android.model} • Android ${runtime.android.androidVersion || '—'}`
                : runtime.android.error || 'Device info unavailable'
            }
            theme={theme}
            styles={styles}
          />
          <Divider />
          <View style={styles.detailRow}>
            <Text variant="bodyMedium" style={styles.detailLabel}>
              SELinux context
            </Text>
            <Text
              variant="bodySmall"
              style={styles.detailValue}
              numberOfLines={1}>
              {extractSelinuxContext(runtime.android.rootIdentity)}
            </Text>
          </View>
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        RUNTIME
      </Text>
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <StatusRow
            label={runtime.termux.appLabel || 'ZeroTermux / Termux'}
            status={runtime.termux.status}
            detail={
              runtime.termux.installed
                ? `${runtime.termux.versionName || 'installed'} • RUN_COMMAND ${
                    runtime.termux.permissionGranted ? 'granted' : 'missing'
                  }`
                : runtime.termux.error || 'Termux-compatible runtime not detected'
            }
            theme={theme}
            styles={styles}
          />
          <Divider />
          <StatusRow
            label="Linux / PRoot"
            status={runtime.linux.status}
            detail={
              runtime.linux.distro
                ? `${runtime.linux.distro} • ${runtime.linux.lastProbe || 'probe ready'}`
                : runtime.linux.error ||
                  (runtime.selfTest.deepCompleted
                    ? 'No Linux distro detected'
                    : 'Run full self-test to probe Linux')
            }
            theme={theme}
            styles={styles}
          />
        </Card.Content>
      </Card>

      <Text variant="titleMedium" style={styles.sectionTitle}>
        AGENT
      </Text>
      <Card style={styles.card} mode="outlined">
        <Card.Content>
          <StatusRow
            label="Agent state"
            status={agentReadiness}
            detail={
              runtime.agent.currentTask
                ? runtime.agent.currentTask
                : `State: ${runtime.agent.status}`
            }
            theme={theme}
            styles={styles}
          />
          <Divider />
          <View style={styles.detailRow}>
            <Text variant="bodyMedium" style={styles.detailLabel}>
              Checkpoint
            </Text>
            <View style={styles.checkpointValue}>
              <Text variant="bodyMedium" style={styles.detailValue}>
                {checkpoint
                  ? `${checkpoint.status.toUpperCase()} • step ${checkpoint.step}${
                      checkpoint.totalSteps ? `/${checkpoint.totalSteps}` : ''
                    }`
                  : 'NONE'}
              </Text>
              {checkpoint?.nextAction ? (
                <Text
                  variant="bodySmall"
                  style={styles.rowDetail}
                  numberOfLines={2}>
                  Next: {checkpoint.nextAction}
                </Text>
              ) : null}
            </View>
          </View>
        </Card.Content>
      </Card>

      {runtime.problems.length > 0 ? (
        <>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            ATTENTION
          </Text>
          <Card style={styles.card} mode="outlined">
            <Card.Content>
              {runtime.problems.map((problem, index) => (
                <Text
                  key={`${index}-${problem}`}
                  variant="bodyMedium"
                  style={styles.problemText}>
                  • {problem}
                </Text>
              ))}
            </Card.Content>
          </Card>
        </>
      ) : null}

      <View style={styles.actions}>
        <Button
          mode="outlined"
          onPress={refreshPassive}
          disabled={checking}
          testID="root-agent-refresh-button">
          Refresh status
        </Button>
        <Button
          mode="contained"
          onPress={runDeepSelfTest}
          loading={checking}
          disabled={checking}
          testID="root-agent-self-test-button">
          Run full self-test
        </Button>
      </View>

      <Text variant="bodySmall" style={styles.footerText}>
        Full self-test is read-only. It may briefly foreground ZeroTermux if
        Android blocks RUN_COMMAND while the terminal app is idle.
      </Text>
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
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 32,
    },
    heroCard: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    heroHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heroTextBlock: {
      flex: 1,
      paddingRight: 12,
    },
    heroTitle: {
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    heroSubtitle: {
      marginTop: 2,
      color: theme.colors.onSurfaceVariant,
    },
    heroStatus: {
      alignItems: 'flex-end',
    },
    heroStatusText: {
      fontWeight: '700',
    },
    heroDivider: {
      marginVertical: 14,
    },
    heroMeta: {
      color: theme.colors.onSurfaceVariant,
    },
    sectionTitle: {
      marginTop: 22,
      marginBottom: 8,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.outline,
    },
    statusRow: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    statusRowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 12,
    },
    statusGlyph: {
      width: 28,
      fontSize: 20,
      fontWeight: '700',
    },
    statusTextBlock: {
      flex: 1,
    },
    rowLabel: {
      color: theme.colors.onSurface,
    },
    rowDetail: {
      marginTop: 2,
      color: theme.colors.onSurfaceVariant,
    },
    statusText: {
      fontWeight: '700',
    },
    detailRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    detailLabel: {
      color: theme.colors.onSurface,
      paddingRight: 12,
    },
    detailValue: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'right',
    },
    checkpointValue: {
      flex: 1,
      alignItems: 'flex-end',
    },
    problemText: {
      color: theme.colors.error,
      marginVertical: 3,
    },
    actions: {
      marginTop: 22,
    },
    footerText: {
      marginTop: 12,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
  });
