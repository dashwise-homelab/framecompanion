import { FrameCompanionConfig } from '../config/schema';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { buildDiscovery } from './discovery';
import { topics } from './topics';

export type MqttState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type MqttStatus = { state: MqttState; lastError?: string };

type NativeMqtt = {
  configure?: (configJson: string) => Promise<void>;
  startService?: () => Promise<void>;
  stopService?: () => Promise<void>;
  testMqtt?: (configJson: string) => Promise<string>;
};

const nativeMqtt = NativeModules.FrameCompanion as NativeMqtt | undefined;

export class MqttClient {
  private status: MqttStatus = { state: 'disabled' };
  private listeners = new Set<(status: MqttStatus) => void>();

  onStatus(listener: (status: MqttStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  async apply(config: FrameCompanionConfig) {
    if (!config.mqtt.enabled || !config.mqtt.host) {
      await nativeMqtt?.stopService?.();
      this.update({ state: 'disabled' });
      return;
    }
    this.update({ state: 'connecting', lastError: undefined });
    try {
      await nativeMqtt?.configure?.(JSON.stringify(config));
      if (Platform.OS === 'android' && nativeMqtt?.startService) {
        await nativeMqtt.startService();
      } else {
        this.update({ state: 'error', lastError: 'Native MQTT service is only available on Android.' });
        return;
      }
      // Foreground service reports the real broker state through its event stream.
      this.update({ state: 'connecting' });
    } catch (error) {
      this.update({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
    }
  }

  async test(config: FrameCompanionConfig) {
    if (!nativeMqtt?.testMqtt) throw new Error('MQTT native service is unavailable. Build Android app first.');
    return nativeMqtt.testMqtt(JSON.stringify(config));
  }

  buildDiscovery(config: FrameCompanionConfig) {
    return buildDiscovery(config);
  }

  stateTopics(config: FrameCompanionConfig) {
    return topics(config);
  }

  private update(status: MqttStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}
