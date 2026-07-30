interface FormFieldOption {
  value: string;
  label: string;
}

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  name?: string;
  // Verilirse <input> yerine <select> render edilir — value/onChange
  // sözleşmesi aynı kalır (bkz. plan: SelectField yerine minimal genişletme).
  options?: FormFieldOption[];
}

const CONTROL_CLASSES =
  "rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function FormField({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  name,
  options,
}: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {options ? (
        <select
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          className={CONTROL_CLASSES}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
          className={CONTROL_CLASSES}
        />
      )}
    </label>
  );
}
