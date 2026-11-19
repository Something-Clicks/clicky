"use client";

import { useFormStatus } from "react-dom";

import type { FormState } from "@/lib/validation";

/** Label + control + inline error, in the reference's .field style. */
export function Field({
  label,
  name,
  state,
  type = "text",
  placeholder,
  defaultValue,
  autoComplete,
  required,
  disabled,
  options,
  inputMode,
}: {
  label: string;
  name: string;
  state?: FormState;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  options?: readonly { value: string; label: string }[];
  inputMode?: "url" | "email" | "text";
}) {
  const error = state?.fieldErrors?.[name];
  const value = state?.values?.[name] ?? defaultValue;
  const id = `f-${name}`;
  const errorId = `${id}-error`;
  const common = {
    id,
    name,
    className: "input",
    defaultValue: value,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  } as const;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {options ? (
        <select {...common} key={value}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
        />
      )}
      {error ? (
        <span className="error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: React.ReactNode; pending: string }) {
  const status = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={status.pending} aria-disabled={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}

/** Form-level message (error or success), announced to screen readers. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="notice error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="notice success" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}
