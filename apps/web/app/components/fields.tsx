"use client";

import type { ReactNode } from "react";
import type {
  FieldError,
  FieldValues,
  Path,
  UseFormRegister,
} from "react-hook-form";

export function Field({
  label,
  hint,
  error,
  sensitive,
  children,
}: {
  label: string;
  hint?: string;
  error?: FieldError;
  sensitive?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {sensitive && (
          <span className="sensitive-tag" title="Shared only with employers">
            shared only with employers
          </span>
        )}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
      {error?.message && <p className="field-error">{error.message}</p>}
    </div>
  );
}

/** A 1–5 rating slider with a live value read-out. */
export function RatingSlider<T extends FieldValues>({
  name,
  value,
  register,
}: {
  name: Path<T>;
  value: number;
  register: UseFormRegister<T>;
}) {
  return (
    <div className="slider-row">
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        className="slider"
        {...register(name, { valueAsNumber: true })}
      />
      <output className="slider-value">{value}</output>
    </div>
  );
}

/** A numeric input that registers as a number for Zod. */
export function NumberInput<T extends FieldValues>({
  name,
  min,
  max,
  step,
  register,
}: {
  name: Path<T>;
  min?: number;
  max?: number;
  step?: number;
  register: UseFormRegister<T>;
}) {
  return (
    <input
      type="number"
      className="input"
      min={min}
      max={max}
      step={step}
      {...register(name, { valueAsNumber: true })}
    />
  );
}

export function Select<T extends FieldValues>({
  name,
  options,
  register,
}: {
  name: Path<T>;
  options: { value: string; label: string }[];
  register: UseFormRegister<T>;
}) {
  return (
    <select className="input" {...register(name)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox<T extends FieldValues>({
  name,
  label,
  register,
}: {
  name: Path<T>;
  label: string;
  register: UseFormRegister<T>;
}) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" {...register(name)} />
      <span>{label}</span>
    </label>
  );
}
