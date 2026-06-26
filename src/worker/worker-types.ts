import type { GroupedNodes, InputFile } from "../utilities/file-helpers.ts";
import type { SerializedEnergyAmount } from "../power-amount.ts";
import type {
  BenchmarkEnergyConsumption,
  SerializedBenchmarkPowerConsumption,
} from "../utilities/power-utilities.ts";
import type {
  BenchmarkBandwidth,
  SerializedBandwidth,
  SerializedBenchmarkBandwidth,
} from "../utilities/bandwidth.ts";

export type SerializedProcessedFile = InputFile & {
  energyConsumption?: SerializedBenchmarkPowerConsumption;
  bandwidth?: SerializedBenchmarkBandwidth;
};

export type ProcessedFile = InputFile & {
  powerConsumption?: BenchmarkEnergyConsumption;
  bandwidth?: BenchmarkBandwidth;
};

export type WorkerInputData = {
  benchmark: string;
  framework: string;
  round: number;
  iterations: Record<number, GroupedNodes>;
};
export type WorkerOutputData = {
  benchmark: string;
  framework: string;
  round: number;
  processed: {
    combinedEnergyAverage?: SerializedEnergyAmount;
    combinedEnergyStandardDeviation?: SerializedEnergyAmount;
    serverEnergyAverage?: SerializedEnergyAmount;
    serverEnergyStandardDeviation?: SerializedEnergyAmount;
    databaseEnergyAverage?: SerializedEnergyAmount;
    databaseEnergyStandardDeviation?: SerializedEnergyAmount;
    clientEnergyAverage?: SerializedEnergyAmount;
    clientEnergyStandardDeviation?: SerializedEnergyAmount;
    clientBandwidthAverage?: SerializedBandwidth;
    clientBandwidthStandardDeviation?: SerializedBandwidth;
  };
  files: {
    iteration: number;
    client: SerializedProcessedFile;
    server: SerializedProcessedFile;
    database: SerializedProcessedFile;
  }[];
};

export const MessageType = {
  Start: 0,
  Finished: 1,
  Error: 2,
  Terminate: 3,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

type PayloadMap = {
  [MessageType.Start]: WorkerInputData;
  [MessageType.Finished]: WorkerOutputData;
  [MessageType.Error]: { error: Error };
  [MessageType.Terminate]: null;
};

export type WorkerMessage<Type extends MessageType> = {
  type: Type;
  payload: PayloadMap[Type];
};

export type MessageStructures = {
  [K in MessageType]: [WorkerMessage<K>, null];
};
