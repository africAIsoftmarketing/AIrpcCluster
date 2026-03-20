import { Chat } from './utils';
/**
 * LM Studio Generator Controller interface (simplified)
 */
export interface GeneratorController {
    write: (text: string) => void;
    statusUpdate: (message: string) => void;
    setConfig: (key: string, value: unknown) => void;
}
/**
 * Main generator function - implements the LM Studio Generator interface
 *
 * @param ctl - Generator controller for output and status updates
 * @param history - Chat history from LM Studio
 */
export declare function generate(ctl: GeneratorController, history: Chat): Promise<void>;
/**
 * Test cluster function - spawns server, sends test request, reports timing
 *
 * @param ctl - Generator controller for output and status updates
 * @returns Test result with response and timing
 */
export declare function testCluster(ctl: GeneratorController): Promise<{
    success: boolean;
    response?: string;
    timeMs?: number;
    error?: string;
    workerCount: number;
}>;
declare const _default: {
    generate: typeof generate;
    testCluster: typeof testCluster;
};
export default _default;
//# sourceMappingURL=generator.d.ts.map