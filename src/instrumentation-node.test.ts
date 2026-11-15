import { describe, expect, it } from 'vitest';

import { deploymentWarning } from './instrumentation-node';

describe('deploymentWarning', () => {
  it('warns only for production without a trusted proxy hop', () => {
    const at = (trustedProxyHopCount: number) => ({ authentication: { trustedProxyHopCount } });
    expect(deploymentWarning('production', at(0))).toMatch(/trustedProxyHopCount is 0/);
    expect(deploymentWarning('production', at(1))).toBeNull();
    expect(deploymentWarning('staging', at(0))).toBeNull();
    expect(deploymentWarning('development', at(0))).toBeNull();
  });
});
