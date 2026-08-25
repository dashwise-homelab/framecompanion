import { FrameCompanionConfig } from '../config/schema';

export function entityId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'device';
}

export function topics(config: FrameCompanionConfig) {
  const root = config.mqtt.topicRoot.replace(/\/+$/, '');
  return {
    root,
    availability: `${root}/availability`,
    state: (entity: string) => `${root}/state/${entityId(entity)}`,
    event: (entity: string) => `${root}/event/${entityId(entity)}`,
    command: (entity: string) => `${root}/command/${entityId(entity)}`,
  };
}

export function discoveryTopic(config: FrameCompanionConfig, component: string, entity: string) {
  const device = entityId(config.mqtt.clientId);
  return `homeassistant/${component}/framecompanion_${device}_${entityId(entity)}/config`;
}
