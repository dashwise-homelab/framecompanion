import { FrameCompanionConfig } from '../config/schema';
import { discoveryMessages } from './entities';

export function buildDiscovery(config: FrameCompanionConfig) {
  return discoveryMessages(config);
}
