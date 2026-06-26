import { parentPort } from "worker_threads";
import {
  MessageType,
  type WorkerMessage,
  type MessageStructures,
  type SerializedProcessedFile,
} from "./worker-types.ts";
import {
  type InputFile,
  loadFile,
  readFile,
} from "../utilities/file-helpers.ts";
import { profilerSchema } from "../schemas/profilerSchema.ts";
import {
  type BenchmarkEnergyConsumption,
  processPowerConsumption,
} from "../utilities/power-utilities.ts";
import {
  EnergyAmount,
  EnergyAmountSeries,
  EnergyAmountUnit,
} from "../power-amount.ts";
import {
  type BenchmarkBandwidth,
  processBandwidth,
} from "../utilities/bandwidth.ts";
import Decimal from "decimal.js";

function onWorkerMessage<T extends MessageType>(
  type: T,
  handler: (message: WorkerMessage<T>) => void,
) {
  parentPort?.on("message", (message) => {
    if (message.type === type) handler(message as WorkerMessage<T>);
  });
}

function getAverageEnergy(inputs: EnergyAmount[]): EnergyAmount | undefined {
  if (inputs.length === 0) return undefined;

  const consumption = inputs.reduce<EnergyAmount>(
    (acc, curr) => {
      acc.addAmount(curr);
      return acc;
    },
    new EnergyAmount(EnergyAmountUnit.PicoWattHour, new Decimal(0)),
  );

  consumption.setAmount(consumption.getAmount().dividedBy(inputs.length));
  return consumption;
}

function getEnergyStandardDeviation(
  inputs: EnergyAmount[],
): EnergyAmount | undefined {
  if (inputs.length === 0) return undefined;

  const mean = inputs
    .reduce<Decimal>((acc, curr) => {
      return acc.add(curr.getAmount(EnergyAmountUnit.PicoWattHour));
    }, new Decimal(0))
    .dividedBy(inputs.length);

  const sumPart = inputs.reduce((acc, curr) => {
    return acc.add(
      curr.getAmount(EnergyAmountUnit.PicoWattHour).sub(mean).pow(2),
    );
  }, new Decimal(0));

  return new EnergyAmount(
    EnergyAmountUnit.PicoWattHour,
    sumPart.div(inputs.length).sqrt(),
  );
}

function getAverageBandwidth(inputs: Decimal[]): Decimal | undefined {
  if (inputs.length === 0) return undefined;

  let totalBytes = new Decimal(0);
  for (const input of inputs) {
    totalBytes = totalBytes.add(input);
  }

  return totalBytes.div(inputs.length);
}

function getBandwidthStandardDeviation(inputs: Decimal[]): Decimal | undefined {
  if (inputs.length === 0) return undefined;

  const mean = getAverageBandwidth(inputs)!;

  const sumPart = inputs.reduce((acc, curr) => {
    return acc.add(new Decimal(curr).sub(mean).pow(2));
  }, new Decimal(0));

  return sumPart.div(inputs.length).sqrt();
}

function postMessage<T extends MessageType>(message: MessageStructures[T][0]) {
  parentPort?.postMessage(message);
}

type ProcessedFile = {
  name: string;
  path: string;
  energyConsumption?: BenchmarkEnergyConsumption;
  bandwidth?: BenchmarkBandwidth;
};

async function processGeckoProfilerFile(
  file: InputFile,
): Promise<ProcessedFile> {
  const loadedFile = await loadFile(file);
  const parsedFile = await profilerSchema.safeParseAsync(
    JSON.parse(loadedFile.content),
  );

  if (!parsedFile.success)
    throw new Error(
      `Failed to parse file: "${file.path}" with error: ${parsedFile.error}`,
    );

  // Identify the process of the utilized tab
  const localhostProcess = parsedFile.data.processes.find((process) => {
    for (const page of process.pages) {
      if (page.url.includes("http://localhost:")) return true;
    }

    return false;
  });

  if (!localhostProcess) {
    throw new Error(
      "Profiling does not contain a process for a page hosted locally",
    );
  }

  const powerCounter = localhostProcess.counters?.find(
    (counter) => counter.category === "power",
  );

  const powerConsumption = powerCounter
    ? processPowerConsumption(powerCounter, localhostProcess.meta.startTime)
    : undefined;

  const bandwidthMarkers = localhostProcess.threads?.find(
    (thread) => thread.name === "GeckoMain",
  )?.markers.data;

  const bandwidth = bandwidthMarkers
    ? processBandwidth(bandwidthMarkers)
    : undefined;

  return {
    energyConsumption: powerConsumption,
    bandwidth,
    ...file,
  };
}

async function processCustomFile(file: InputFile): Promise<ProcessedFile> {
  const powerConsumption: {
    total: Decimal;
    measurements: { time: Decimal; energy: Decimal }[];
  } = {
    total: new Decimal(0),
    measurements: [],
  };

  await readFile(file, (line, lineNumber) => {
    // Skip header line
    if (lineNumber === 0) return;

    const [time, energy] = line.split(",");

    if (!time || !energy)
      throw new Error(
        `Line: ${lineNumber} did not contain both time and energy entries in file: ${file.path}`,
      );

    const [parsedTime, parsedEnergy] = [Decimal(time), Decimal(energy)];

    powerConsumption.total = powerConsumption.total.add(parsedEnergy);
    powerConsumption.measurements.push({
      time: parsedTime,
      energy: parsedEnergy,
    });
  });

  return {
    energyConsumption: {
      total: new EnergyAmount(
        EnergyAmountUnit.NanoJoule,
        powerConsumption.total,
      ),
      measurements: new EnergyAmountSeries(
        EnergyAmountUnit.NanoJoule,
        powerConsumption.measurements,
      ),
    },
    ...file,
  };
}

function serializeProcessedFile(
  processedFile: ProcessedFile,
): SerializedProcessedFile {
  return {
    ...processedFile,
    energyConsumption: processedFile.energyConsumption
      ? {
          total: processedFile.energyConsumption.total.toJSON(),
          measurements: processedFile.energyConsumption.measurements.toJSON(),
        }
      : undefined,
    bandwidth: processedFile.bandwidth
      ? {
          total: processedFile.bandwidth.total.toString(),
          measurements: processedFile.bandwidth.measurements.map(
            ([file, bandwidth]) => [file, bandwidth.toString()],
          ),
        }
      : undefined,
  };
}

(async () => {
  if (!parentPort) throw new Error("Message channel 'parentPort' not defined");

  onWorkerMessage(MessageType.Start, async ({ payload }) => {
    const fileProcessingPromises = Object.entries(payload.iterations).map(
      async ([iteration, nodes]) => {
        return {
          iteration: Number(iteration),
          client: await processGeckoProfilerFile(nodes.client),
          server: await processCustomFile(nodes.server),
          database: await processCustomFile(nodes.database),
        };
      },
    );

    const processedFiles = await Promise.all(fileProcessingPromises);

    // Extract measurements
    const combinedEnergyConsumption: EnergyAmount[] = [];
    const serverEnergyConsumption: EnergyAmount[] = [];
    const databaseEnergyConsumption: EnergyAmount[] = [];
    const clientEnergyConsumption: EnergyAmount[] = [];
    const clientBandwidthConsumption: Decimal[] = [];

    // TODO: Make sure that the iterations has the correct order in the list
    for (const file of processedFiles) {
      const databaseEnergy = file.database.energyConsumption?.total;
      const serverEnergy = file.server.energyConsumption?.total;
      const clientEnergy = file.client.energyConsumption?.total;
      const clientBandwidth = file.client.bandwidth?.total;

      if (serverEnergy) serverEnergyConsumption.push(serverEnergy);
      if (databaseEnergy) databaseEnergyConsumption.push(databaseEnergy);
      if (clientEnergy) clientEnergyConsumption.push(clientEnergy);
      if (clientBandwidth) clientBandwidthConsumption.push(clientBandwidth);

      if (
        serverEnergy !== undefined &&
        databaseEnergy !== undefined &&
        clientEnergy !== undefined
      ) {
        const combined = new EnergyAmount(
          EnergyAmountUnit.NanoJoule,
          serverEnergy.getAmount(EnergyAmountUnit.NanoJoule),
        );
        combined.addAmount(databaseEnergy);
        combined.addAmount(clientEnergy);
        combinedEnergyConsumption.push(combined);
      }
    }

    /** Calculate averages and standard deviations */
    // Total energy
    const combinedEnergyAverage = getAverageEnergy(
      combinedEnergyConsumption,
    )?.toJSON();
    const combinedEnergyStandardDeviation = getEnergyStandardDeviation(
      combinedEnergyConsumption,
    )?.toJSON();

    // Server energy
    const serverEnergyAverage = getAverageEnergy(
      serverEnergyConsumption,
    )?.toJSON();
    const serverEnergyStandardDeviation = getEnergyStandardDeviation(
      serverEnergyConsumption,
    )?.toJSON();

    // Server energy
    const databaseEnergyAverage = getAverageEnergy(
      databaseEnergyConsumption,
    )?.toJSON();
    const databaseEnergyStandardDeviation = getEnergyStandardDeviation(
      databaseEnergyConsumption,
    )?.toJSON();

    // Client energy
    const clientEnergyAverage = getAverageEnergy(
      clientEnergyConsumption,
    )?.toJSON();
    const clientEnergyStandardDeviation = getEnergyStandardDeviation(
      clientEnergyConsumption,
    )?.toJSON();

    // Client bandwidth
    const clientBandwidthAverage = getAverageBandwidth(
      clientBandwidthConsumption,
    )?.toString();
    const clientBandwidthStandardDeviation = getBandwidthStandardDeviation(
      clientBandwidthConsumption,
    )?.toString();

    postMessage({
      type: MessageType.Finished,
      payload: {
        benchmark: payload.benchmark,
        framework: payload.framework,
        round: payload.round,
        processed: {
          combinedEnergyAverage,
          combinedEnergyStandardDeviation,
          serverEnergyAverage,
          serverEnergyStandardDeviation,
          databaseEnergyAverage,
          databaseEnergyStandardDeviation,
          clientEnergyAverage,
          clientEnergyStandardDeviation,
          clientBandwidthAverage,
          clientBandwidthStandardDeviation,
        },
        files: processedFiles.map((f) => {
          return {
            iteration: f.iteration,
            client: serializeProcessedFile(f.client),
            server: serializeProcessedFile(f.server),
            database: serializeProcessedFile(f.database),
          };
        }),
      },
    });
  });

  await new Promise<void>((res, rej) => {
    onWorkerMessage(MessageType.Terminate, () => {
      res();
    });
  });
})()
  .catch((err) => {
    parentPort?.postMessage({
      type: MessageType.Error,
      payload: { error: err },
    });
  })
  .finally(() => process.exit(0));
