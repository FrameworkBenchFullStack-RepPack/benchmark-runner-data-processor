# benchmark-runner-data-processor

A CLI tool for parsing and extracting relevant energy and bandwidth information from Gecko Profiler outputs.

## Setup

### 1. Clone the Repository

To clone the repository run the following git command:

```bash
git clone https://github.com/FrameworkBenchFullStack-RepPack/gecko-profiler-parser.git
cd ./gecko-profiler-parser
```

### 2. Configure the Project

After cloning, install dependencies:

```bash
npm install
```

## Running the Parser

The project provides a single script:

```bash
npm run parse
```

To view available options and usage details, run:

```
$ npm run parse -- --help
> benchmark-runner-data-processor@2.0.0 parse
> tsx src/index.ts --help

Usage: benchmark-runner-data-processor [options] <path>

A CLI tool for processing benchmark-runner outputs

Arguments:
  path                     Path to a profiler a folder containing benchmark-runner outputs

Options:
  -V, --version            output the version number
  -t, --threads <entries>  specify number of workers to use (default: "1")
  --export-raw             export power measurements in csv file (default: false)
  --print-results          print results to terminal (default: false)
  -h, --help               display help for command
```
