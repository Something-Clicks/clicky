import { zeroUsage } from '@/agent/providers/usage';
export const ZERO_USAGE = () => ({ ...zeroUsage() });
