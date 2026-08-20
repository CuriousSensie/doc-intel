export function FormMessage({
  error,
  message
}: {
  error?: string | string[];
  message?: string | string[];
}) {
  const errorText = Array.isArray(error) ? error[0] : error;
  const messageText = Array.isArray(message) ? message[0] : message;

  if (!errorText && !messageText) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-3 py-2 text-sm ${
        errorText
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
      role="status"
    >
      {errorText ?? messageText}
    </p>
  );
}
