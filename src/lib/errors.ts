export type SafeErrorShape = {
  code: string;
  message: string;
  status: number;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;

  constructor(message: string, options: { code: string; status: number; expose?: boolean }) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.status = options.status;
    this.expose = options.expose ?? options.status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(message, { code: "validation_error", status: 400 });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { code: "authentication_error", status: 401 });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You are not allowed to perform this action") {
    super(message, { code: "authorization_error", status: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { code: "not_found", status: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(message, { code: "conflict", status: 409 });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, { code: "rate_limited", status: 429 });
  }
}

export class BillingError extends AppError {
  constructor(message = "Billing operation failed") {
    super(message, { code: "billing_error", status: 400 });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large") {
    super(message, { code: "payload_too_large", status: 413 });
  }
}

export class UnprocessableError extends AppError {
  constructor(message = "Valid shape, invalid business state") {
    super(message, { code: "unprocessable", status: 422 });
  }
}

export class PaperlessUnavailableError extends AppError {
  constructor(message = "Upstream document service unavailable") {
    super(message, { code: "paperless_unavailable", status: 502 });
  }
}

export class OrgNotProvisionedError extends AppError {
  constructor(message = "Tenant provisioning incomplete or failed") {
    super(message, { code: "org_not_provisioned", status: 503 });
  }
}

export function toSafeError(error: unknown): SafeErrorShape {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.expose ? error.message : "Internal server error",
      status: error.status
    };
  }

  return {
    code: "internal_server_error",
    message: "Internal server error",
    status: 500
  };
}
