// Consistent, non-leaky API error shape — see docs/api.md §Error Shape.

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = "Authentication is required.") {
    return new ApiError(401, "UNAUTHENTICATED", message);
  }
  static forbidden(code = "ACCESS_DENIED", message = "You do not have permission to perform this action.") {
    return new ApiError(403, code, message);
  }
  static notFound(resource = "Resource") {
    return new ApiError(404, "NOT_FOUND", `${resource} was not found.`);
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }
  static tooManyRequests(message = "Too many requests. Please try again later.") {
    return new ApiError(429, "RATE_LIMITED", message);
  }
  static internal(message = "An unexpected error occurred.") {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}
