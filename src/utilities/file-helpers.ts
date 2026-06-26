import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline/promises";

export class FileLoadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomError";
    Object.setPrototypeOf(this, FileLoadingError.prototype);
  }
}

export type InputFile = {
  name: string;
  path: string;
};

export type GroupedNodes = {
  client: InputFile;
  server: InputFile;
  database: InputFile;
};

export type GroupedBenchmarks<NodesContainer> = Record<
  string,
  Record<string, Record<number, Record<number, NodesContainer>>>
>;

export type ImportedFile<T = string> = InputFile & {
  content: T;
};

export function getAbsolutePath(input: string) {
  // Absolute path - Return normalized path
  if (path.isAbsolute(input)) {
    return path.normalize(input);
  }

  // Relative path - Return resolved path
  return path.resolve(process.cwd(), input);
}

export async function getBenchmarkFiles(
  inputPath: string,
): Promise<InputFile[]> {
  const processedPath = getAbsolutePath(inputPath);

  if (!existsSync(processedPath))
    throw new FileLoadingError(
      `Incorrect path - does not exist: ${processedPath}`,
    );

  const pathStats = await fs.lstat(processedPath);

  if (!pathStats.isDirectory()) {
    throw new FileLoadingError(
      `Path does not point to a file or folder - ${inputPath}`,
    );
  }

  let files = await fs
    .readdir(processedPath)
    .then((files) =>
      files.filter((f) => f.endsWith(".json") || f.endsWith(".csv")),
    );

  if (files.length < 1)
    throw new FileLoadingError(
      `Folder does not contain any files - ${processedPath}`,
    );

  return files.map((file) => {
    const filePath = path.join(processedPath, file);
    return {
      name: file,
      path: filePath,
    };
  });
}

export async function loadFile(
  inputFile: InputFile,
): Promise<ImportedFile<string>> {
  return {
    ...inputFile,
    content: await fs.readFile(inputFile.path, "utf8"),
  };
}

export async function readFile(
  inputFile: InputFile,
  processLine: (line: string, lineNumber?: number) => void,
): Promise<void> {
  await new Promise((res, rej) => {
    const readInterface = readline.createInterface({
      input: createReadStream(inputFile.path),
    });

    let lineNumber = 0;

    readInterface.on("line", (line) => {
      processLine(line, lineNumber);
      lineNumber += 1;
    });
    readInterface.on("error", rej);
    readInterface.on("close", res);
  });
}

function isCompleteGroupedBenchmarks(
  input: GroupedBenchmarks<Partial<GroupedNodes>>,
): input is GroupedBenchmarks<GroupedNodes> {
  return !Object.values(input).some((benchmark) =>
    Object.values(benchmark).some((framework) =>
      Object.values(framework).some((round) =>
        Object.values(round).some(
          (iteration) =>
            iteration.client === undefined ||
            iteration.server === undefined ||
            iteration.database === undefined,
        ),
      ),
    ),
  );
}

export function groupFiles(
  files: InputFile[],
): GroupedBenchmarks<GroupedNodes> {
  // Record<BenchmarkName, Record<Framework, Record<Round, Record<Iteration, Client / Server files>>>>
  const benchmarks: GroupedBenchmarks<Partial<GroupedNodes>> = {};
  for (const file of files) {
    const [filename] = file.name.split(".");
    if (!filename) throw new Error("Filename is undefined");

    const [benchmark, framework, iteration, round, node] = filename.split("_");
    const parsedIteration = Number(iteration);
    const parsedRound = Number(round);

    if (
      !iteration ||
      !Number.isSafeInteger(parsedIteration) ||
      !round ||
      !Number.isSafeInteger(parsedRound) ||
      !benchmark ||
      !framework ||
      (node !== "client" && node !== "server" && node !== "database")
    )
      throw new Error(
        "Invalid filename - Does not follow convention 'framework_benchmark_iteration_(client.json|server.csv|database.csv)'",
      );

    // Create object and list if necessary and add file
    (((benchmarks[benchmark] ??= {})[framework] ??= {})[parsedRound] ??= {})[
      parsedIteration
    ] ??= {};
    benchmarks[benchmark][framework][parsedRound][parsedIteration][node] = file;
  }

  if (!isCompleteGroupedBenchmarks(benchmarks))
    throw new Error(
      "Some iteration did not have both client and server side energy consumption",
    );

  return benchmarks;
}

interface ResultsPathProps {
  inputPath: string;
  resultsFolderName: string;
  summedResultsFolderName: string;
  combinedResultsFolderName: string;
  rawResultsFolderName?: string;
}

export async function getResultsPaths({
  inputPath,
  resultsFolderName,
  summedResultsFolderName,
  combinedResultsFolderName,
  rawResultsFolderName,
}: ResultsPathProps): Promise<[string, string, string, string | undefined]> {
  const absoluteInputPath = getAbsolutePath(inputPath);

  const pathStats = await fs.lstat(absoluteInputPath);
  const resultsPath = pathStats.isDirectory()
    ? path.join(absoluteInputPath, `/${resultsFolderName}`)
    : pathStats.isFile()
      ? path.resolve(absoluteInputPath, "../")
      : undefined;

  if (resultsPath === undefined)
    throw new Error(`Path does not point to a folder or a file: ${inputPath}`);

  if (!existsSync(resultsPath)) await fs.mkdir(resultsPath);

  // Total results path
  const totalResultsPath = path.join(resultsPath, summedResultsFolderName);
  if (!existsSync(totalResultsPath)) await fs.mkdir(totalResultsPath);

  // Combined results path
  const combinedResultsPath = path.join(resultsPath, combinedResultsFolderName);
  if (!existsSync(combinedResultsPath)) await fs.mkdir(combinedResultsPath);

  // Raw results path
  const rawResultsPath = rawResultsFolderName
    ? path.join(resultsPath, rawResultsFolderName)
    : undefined;

  if (rawResultsPath && !existsSync(rawResultsPath))
    await fs.mkdir(rawResultsPath);

  return [resultsPath, totalResultsPath, combinedResultsPath, rawResultsPath];
}
