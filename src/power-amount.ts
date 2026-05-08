import Decimal from "decimal.js";
export const EnergyAmountUnit = {
  PicoWattHour: "pWh",
  MicroWattHour: "μWh",
  MilliWattHour: "mWh",
  WattHour: "Wh",
  Joule: "J",
  NanoJoule: "nJ",
} as const;

export type EnergyAmountUnit =
  (typeof EnergyAmountUnit)[keyof typeof EnergyAmountUnit];

const _conversionToWh: Record<EnergyAmountUnit, Decimal> = {
  [EnergyAmountUnit.PicoWattHour]: new Decimal(1e-12), // 1 pWh = 1e-12 Wh
  [EnergyAmountUnit.MicroWattHour]: new Decimal(1e-6), // 1 μWh = 1e-6 Wh
  [EnergyAmountUnit.MilliWattHour]: new Decimal(1e-3), // 1 mWh = 1e-3 Wh
  [EnergyAmountUnit.WattHour]: new Decimal(1), // 1 Wh = 1 Wh
  [EnergyAmountUnit.Joule]: new Decimal(1).dividedBy(3600), // 1 J = 1 / 3600 Wh
  [EnergyAmountUnit.NanoJoule]: new Decimal("1e-9").dividedBy(3600), // 1 nJ = 1e-9 / 3600 Wh
} as const;

function _convertEnergy(
  newUnit: EnergyAmountUnit,
  currUnit: EnergyAmountUnit,
  currAmount: Decimal,
) {
  const amountInWh = currAmount.times(_conversionToWh[currUnit]);
  return amountInWh.dividedBy(_conversionToWh[newUnit]);
}

export type SerializedEnergyAmount = {
  amount: string;
  unit: EnergyAmountUnit;
};

export class EnergyAmount {
  #unit: EnergyAmountUnit;
  #amount: Decimal;

  constructor(unit: EnergyAmountUnit, amount: Decimal) {
    this.#unit = unit;
    this.#amount = amount;
  }

  /**
   * Function to convert the energy amount to another unit
   * @param newUnit The new energy unit
   */
  convert(newUnit: EnergyAmountUnit) {
    if (this.#unit === newUnit) return;

    this.#amount = _convertEnergy(newUnit, this.#unit, this.#amount);
    this.#unit = newUnit;
  }

  /**
   * Function to get the energy amount
   * @param newUnit An optional unit for the returned energy
   * @returns The amount of energy
   */
  getAmount(newUnit: EnergyAmountUnit = EnergyAmountUnit.PicoWattHour) {
    if (newUnit !== this.#unit)
      return _convertEnergy(newUnit, this.#unit, this.#amount);
    return this.#amount;
  }

  /**
   * Function to set the energy amount
   * @param amount An optional unit for the returned energy
   * @returns The amount of energy
   */
  addAmount(amount: EnergyAmount) {
    this.#amount = this.#amount.add(amount.getAmount(this.#unit));
  }

  setAmount(amount: Decimal) {
    this.#amount = amount;
  }

  /**
   * Getter for the energy unit
   * @returns The energy unit
   */
  getUnit() {
    return this.#unit;
  }

  /**
   * Utility function to get a preformatted string
   * @param decimals Number of decimals to show for the energy amount
   * @returns A string representation of the energy amount
   */
  getString(decimals?: number): string {
    return `${decimals ? this.#amount.toFixed(decimals) : this.#amount} ${
      this.#unit
    }`;
  }

  /**
   * Function to facilitate passing these objects between worker and main thread
   * @returns An object representing the EnergyAmount object
   */
  toJSON(): SerializedEnergyAmount {
    return {
      amount: this.#amount.toString(),
      unit: this.#unit,
    };
  }

  static fromJSON(
    input: SerializedEnergyAmount | undefined,
  ): EnergyAmount | undefined {
    if (input === undefined) return undefined;
    return new EnergyAmount(input.unit, new Decimal(input.amount));
  }
}

export type SerializedEnergyAmountSeries = {
  series: { time: string; energy: string }[];
  unit: EnergyAmountUnit;
};

export class EnergyAmountSeries {
  #series: { time: Decimal; energy: Decimal }[];
  #unit: EnergyAmountUnit;

  constructor(
    unit: EnergyAmountUnit,
    series?: { time: Decimal; energy: Decimal }[],
  ) {
    this.#series = series ? series : [];
    this.#unit = unit;
  }

  /**
   * Function to convert the energy amounts to another unit
   * @param newUnit The new energy unit
   */
  convert(newUnit: EnergyAmountUnit) {
    if (this.#unit === newUnit) return;

    for (const entry of this.#series) {
      entry.energy = _convertEnergy(newUnit, this.#unit, entry.energy);
    }

    this.#unit = newUnit;
  }

  /**
   * Function to get the measurement series
   * @param newUnit An optional unit for the returned energy
   * @returns The amount of energy
   */
  getMeasurements(newUnit: EnergyAmountUnit = EnergyAmountUnit.PicoWattHour) {
    if (newUnit !== this.#unit)
      return this.#series.map((entry) => {
        return {
          time: entry.time,
          energy: _convertEnergy(newUnit, this.#unit, entry.energy),
        };
      });
    return this.#series;
  }

  /**
   * Getter for the energy unit
   * @returns The energy unit
   */
  getUnit() {
    return this.#unit;
  }

  /**
   * Function to facilitate passing these objects between worker and main thread
   * @returns An object representing the EnergyAmountTimeSeries object
   */
  toJSON(): SerializedEnergyAmountSeries {
    return {
      series: this.#series.map(({ time, energy: energy }) => {
        return { time: time.toString(), energy: energy.toString() };
      }),
      unit: this.#unit,
    };
  }

  static fromJSON(
    input: SerializedEnergyAmountSeries | undefined,
  ): EnergyAmountSeries | undefined {
    if (input === undefined) return undefined;
    return new EnergyAmountSeries(
      input.unit,
      input.series.map(({ time, energy: energy }) => {
        return { time: new Decimal(time), energy: new Decimal(energy) };
      }),
    );
  }
}
