import Decimal from "decimal.js";
import {
  EnergyAmountUnit,
  EnergyAmount,
  EnergyAmountSeries,
  type SerializedEnergyAmount,
  type SerializedEnergyAmountSeries,
} from "../power-amount.ts";
import { type Counter } from "../schemas/profilerSchema.ts";

export type SerializedBenchmarkPowerConsumption = {
  total: SerializedEnergyAmount;
  measurements: SerializedEnergyAmountSeries;
};

export type BenchmarkEnergyConsumption = {
  total: EnergyAmount;
  measurements: EnergyAmountSeries;
};

export function processPowerConsumption(
  counter: Counter,
): BenchmarkEnergyConsumption {
  if (counter.category !== "power")
    throw new Error("Counter does not contain power samples");

  const timeIndex = counter.samples.schema["time"];
  const powerIndex = counter.samples.schema["count"];

  if (timeIndex === undefined || powerIndex === undefined)
    throw new Error("Counter does not contain power samples");

  const powerConsumption: {
    total: Decimal;
    measurements: { time: Decimal; energy: Decimal }[];
  } = {
    total: new Decimal(0),
    measurements: [],
  };

  for (const sample of counter.samples.data) {
    const time = sample[timeIndex];
    const power = sample[powerIndex];

    if (!time || !power) throw new Error("Time or power not defined");

    powerConsumption.total = powerConsumption.total.add(power);
    powerConsumption.measurements.push({
      time: new Decimal(time),
      energy: new Decimal(power),
    });
  }

  return {
    total: new EnergyAmount(
      EnergyAmountUnit.PicoWattHour,
      powerConsumption.total,
    ),
    measurements: new EnergyAmountSeries(
      EnergyAmountUnit.PicoWattHour,
      powerConsumption.measurements,
    ),
  };
}
