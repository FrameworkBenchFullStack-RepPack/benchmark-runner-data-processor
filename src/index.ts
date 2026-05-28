import { program } from "commander";
import path from "node:path";
import {
  getBenchmarkFiles,
  getResultsPaths,
  groupFiles,
} from "./utilities/file-helpers";
import { WorkerInputData, WorkerOutputData } from "./worker/worker-types";
import {
  EnergyAmount,
  EnergyAmountSeries,
  EnergyAmountUnit,
} from "./power-amount";
import { startWorker } from "./worker/start-worker";
import { writeCSV } from "./utilities/csv-utilities";
import Decimal from "decimal.js";

const PROCESSING_WORKER_PATH = path.resolve(
  import.meta.dirname,
  "./worker/worker.ts",
);

(async () => {
  program
    .name("benchmark-runner-data-processor")
    .description("A CLI tool for processing benchmark-runner outputs")
    .version("1.0.0")
    .argument(
      "<path>",
      "Path to a profiler a folder containing benchmark-runner outputs",
    )
    .option("-t, --threads <entries>", "specify number of workers to use", "1")
    .option("--export-raw", "export power measurements in csv file", false)
    .option("--print-results", "print results to terminal", false);

  // Parse program and extract options
  program.parse();
  const options = program.opts();

  const inputPath = program.args[0];
  if (!inputPath || typeof inputPath !== "string")
    throw new Error("Passed path is not a string");

  const threads = Number.parseInt(options.threads);

  // Get and organize relevant files
  const files = await getBenchmarkFiles(inputPath);
  const groupedFiles = groupFiles(files);

  // Prepare variables
  const tasks: WorkerInputData[] = [];
  const processedData: WorkerOutputData[] = [];

  // Create worker tasks
  for (const [benchmark, frameworks] of Object.entries(groupedFiles)) {
    console.log(`Benchmark: ${benchmark}`);
    for (const [framework, rounds] of Object.entries(frameworks)) {
      for (const [roundKey, iterations] of Object.entries(rounds)) {
        // Has already been parsed as a safe integer
        const round = Number(roundKey);

        console.log(
          `Creating Worker Task - Framework: ${framework} - Round: ${round}, Iterations: ${Object.entries(iterations).length}`,
        );

        const workerData: WorkerInputData = {
          benchmark,
          framework,
          round,
          iterations,
        };
        tasks.push(workerData);
      }
    }
  }

  // Schedule threads
  console.log(`Starting ${threads} workers`);

  const workers: Promise<void>[] = [];
  for (let i = 0; i < threads; i++) {
    const task = tasks.pop();
    if (!task) break;
    workers.push(
      startWorker({
        initialTask: task,
        taskQueue: tasks,
        processedData,
        workerPath: PROCESSING_WORKER_PATH,
      }),
    );
  }
  await Promise.all(workers);

  const [resultsPath, summedResultsPath, combinedResultsPath, rawResultsPath] =
    await getResultsPaths({
      inputPath,
      resultsFolderName: "processed-results",
      summedResultsFolderName: "summed-results",
      combinedResultsFolderName: "combined-results",
      rawResultsFolderName: options.exportRaw
        ? "extracted-raw-results"
        : undefined,
    });

  // Deserialize results
  const deserializedResults = processedData.map((r) => {
    return {
      ...r,
      processed: {
        combinedEnergyAverage: EnergyAmount.fromJSON(
          r.processed.combinedEnergyAverage,
        ),
        combinedEnergyStandardDeviation: EnergyAmount.fromJSON(
          r.processed.combinedEnergyStandardDeviation,
        ),
        serverEnergyAverage: EnergyAmount.fromJSON(
          r.processed.serverEnergyAverage,
        ),
        serverEnergyStandardDeviation: EnergyAmount.fromJSON(
          r.processed.serverEnergyStandardDeviation,
        ),
        clientEnergyAverage: EnergyAmount.fromJSON(
          r.processed.clientEnergyAverage,
        ),
        clientEnergyStandardDeviation: EnergyAmount.fromJSON(
          r.processed.clientEnergyStandardDeviation,
        ),
        clientBandwidthAverage: r.processed.clientBandwidthAverage
          ? new Decimal(r.processed.clientBandwidthAverage)
          : undefined,
        clientBandwidthStandardDeviation: r.processed
          .clientBandwidthStandardDeviation
          ? new Decimal(r.processed.clientBandwidthStandardDeviation)
          : undefined,
      },
      files: r.files.map((f) => {
        return {
          iteration: f.iteration,
          client: {
            ...f.client,
            energyConsumption: {
              total: EnergyAmount.fromJSON(f.client.energyConsumption?.total),
              measurements: EnergyAmountSeries.fromJSON(
                f.client.energyConsumption?.measurements,
              ),
            },
            bandwidth: f.client.bandwidth
              ? {
                  total: new Decimal(f.client.bandwidth?.total),
                  measurements: f.client.bandwidth.measurements.map<
                    [string, Decimal]
                  >(([file, bandwidth]) => [file, new Decimal(bandwidth)]),
                }
              : undefined,
          },
          server: {
            ...f.server,
            energyConsumption: {
              total: EnergyAmount.fromJSON(f.server.energyConsumption?.total),
              measurements: EnergyAmountSeries.fromJSON(
                f.server.energyConsumption?.measurements,
              ),
            },
          },
        };
      }),
    };
  });

  const getCsvEntry = (amount: EnergyAmount | undefined): string => {
    return amount?.getAmount(EnergyAmountUnit.Joule).toString() ?? "N/A";
  };

  /* Export per benchmark CSV processed results*/
  const perBenchmarkCsvEntries = deserializedResults.reduce<
    Record<string, string[][]>
  >((acc, result) => {
    acc[result.benchmark] ??= [];

    acc[result.benchmark]?.push([
      result.framework,
      String(result.round),
      getCsvEntry(result.processed.combinedEnergyAverage),
      getCsvEntry(result.processed.combinedEnergyStandardDeviation),
      getCsvEntry(result.processed.clientEnergyAverage),
      getCsvEntry(result.processed.clientEnergyStandardDeviation),
      getCsvEntry(result.processed.serverEnergyAverage),
      getCsvEntry(result.processed.serverEnergyStandardDeviation),
      result.processed.clientBandwidthAverage?.toString() ?? "N/A",
      result.processed.clientBandwidthStandardDeviation?.toString() ?? "N/A",
    ]);

    return acc;
  }, {});

  for (const [benchmark, result] of Object.entries(perBenchmarkCsvEntries)) {
    writeCSV({
      path: resultsPath + `/${benchmark}.csv`,
      header: [
        "Framework",
        "Round",
        `Combined Energy Average (${EnergyAmountUnit.Joule})`,
        `Combined Energy SD (${EnergyAmountUnit.Joule})`,
        `Client Energy Average (${EnergyAmountUnit.Joule})`,
        `Client Energy SD (${EnergyAmountUnit.Joule})`,
        `Server Energy Average (${EnergyAmountUnit.Joule})`,
        `Server Energy SD (${EnergyAmountUnit.Joule})`,
        `Client Bandwidth Average (B)`,
        `Client Bandwidth SD (B)`,
      ],
      fields: result,
    });
  }

  /* Export per benchmark CSV processed results*/
  const combinedPerBenchmarkIterations = deserializedResults.reduce<
    Record<string, Record<string, string[][]>>
  >((acc, result) => {
    (acc[result.benchmark] ??= {})[result.round] ??= [];

    for (const file of result.files) {
      acc[result.benchmark]?.[result.round]?.push([
        result.framework,
        getCsvEntry(file.client.energyConsumption.total),
        getCsvEntry(file.server.energyConsumption.total),
        file.client.bandwidth?.total?.toString() ?? "N/A",
      ]);
    }

    return acc;
  }, {});

  for (const [benchmark, rounds] of Object.entries(
    combinedPerBenchmarkIterations,
  )) {
    for (const [round, result] of Object.entries(rounds)) {
      writeCSV({
        path: combinedResultsPath + `/${benchmark}_round-${round}.csv`,
        header: [
          "Framework",
          `Client Energy (${EnergyAmountUnit.Joule})`,
          `Server Energy (${EnergyAmountUnit.Joule})`,
          `Client Bandwidth (B)`,
        ],
        fields: result,
      });
    }
  }

  // Print output to terminal
  if (options.printResults) {
    console.log(
      `Benchmark - Round - Combined Energy Avg - Combined Energy SD - Server Energy Avg - Server Energy SD - Client Energy Avg - Client Energy SD - Bandwidth Avg - Bandwidth SD - Framework`,
    );
  }

  for (const result of deserializedResults
    .toSorted((first, second) => (first.benchmark > second.benchmark ? -1 : 1))
    .toSorted((first, second) => first.round - second.round)) {
    result.processed.combinedEnergyAverage?.convert(EnergyAmountUnit.Joule);
    result.processed.combinedEnergyStandardDeviation?.convert(
      EnergyAmountUnit.Joule,
    );
    result.processed.serverEnergyAverage?.convert(EnergyAmountUnit.Joule);
    result.processed.serverEnergyStandardDeviation?.convert(
      EnergyAmountUnit.Joule,
    );
    result.processed.clientEnergyAverage?.convert(EnergyAmountUnit.Joule);
    result.processed.clientEnergyStandardDeviation?.convert(
      EnergyAmountUnit.Joule,
    );

    // Print output to terminal
    if (options.printResults) {
      console.log(
        `${result.benchmark} - ${result.round} - ${
          result.processed.combinedEnergyAverage
            ? result.processed.combinedEnergyAverage.getString(2)
            : "N/A"
        } - ${
          result.processed.combinedEnergyStandardDeviation
            ? result.processed.combinedEnergyStandardDeviation.getString(2)
            : "N/A"
        } - ${
          result.processed.serverEnergyAverage
            ? result.processed.serverEnergyAverage.getString(2)
            : "N/A"
        } - ${
          result.processed.serverEnergyStandardDeviation
            ? result.processed.serverEnergyStandardDeviation.getString(2)
            : "N/A"
        } - ${
          result.processed.clientEnergyAverage
            ? result.processed.clientEnergyAverage.getString(2)
            : "N/A"
        } - ${
          result.processed.clientEnergyStandardDeviation
            ? result.processed.clientEnergyStandardDeviation.getString(2)
            : "N/A"
        } - ${
          result.processed.clientBandwidthAverage
            ? `${result.processed.clientBandwidthAverage.div(1000)} KB`
            : "N/A"
        } - ${
          result.processed.clientBandwidthStandardDeviation
            ? `${result.processed.clientBandwidthStandardDeviation.div(1000)} KB`
            : "N/A"
        } - ${result.framework}`,
      );
    }

    // Extract total power measurements
    writeCSV({
      path:
        summedResultsPath +
        `/${result.benchmark}_${result.framework}_round-${result.round}.csv`,
      header: [
        "Iteration",
        `Server Energy (${EnergyAmountUnit.Joule})`,
        `Client Energy (${EnergyAmountUnit.Joule})`,
        "Client Bandwidth (B)",
      ],
      fields: result.files.map((processedFile) => [
        processedFile.iteration,
        getCsvEntry(processedFile.server.energyConsumption.total),
        getCsvEntry(processedFile.client.energyConsumption.total),
        processedFile.client.bandwidth?.total.toString() ?? "N/A",
      ]),
    });

    if (options.exportRaw) {
      for (const file of result.files) {
        const fileName = file.client.name.split(".")[0];
        if (!fileName) throw new Error("Splitting file failed");

        // Convert
        file.client.energyConsumption?.measurements?.convert(
          EnergyAmountUnit.NanoJoule,
        );
        file.server.energyConsumption?.measurements?.convert(
          EnergyAmountUnit.NanoJoule,
        );

        // Energy consumption files
        [
          {
            name: file.client.name,
            measurements: file.client.energyConsumption?.measurements,
          },
          {
            name: file.server.name,
            measurements: file.server.energyConsumption?.measurements,
          },
        ].forEach(({ name, measurements }) => {
          const unit = measurements?.getUnit() ?? EnergyAmountUnit.NanoJoule;
          writeCSV({
            path: rawResultsPath + `/${name}_energy-raw.csv`,
            header: ["Time", `Energy (${unit})`],
            fields:
              measurements
                ?.getMeasurements(unit)
                .map((measurement) => [
                  measurement.time.toString(),
                  measurement.energy.toString(),
                ]) ?? [],
          });
        });

        // Bandwidth files
        writeCSV({
          path: rawResultsPath + `/${file.client.name}_bandwidth-raw.csv`,
          header: ["File", "Total Bandwidth (B)"],
          fields:
            file.client.bandwidth?.measurements.map(([file, size]) => [
              file,
              size.toString(),
            ]) ?? [],
        });
      }
    }
  }
})();
