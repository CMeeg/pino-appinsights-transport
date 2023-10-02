import { TelemetryClient, KnownSeverityLevel } from 'applicationinsights'
import type { ExceptionTelemetry, TraceTelemetry } from 'applicationinsights'
import build from 'pino-abstract-transport'

function pinoLevelToSeverityLevel(level: number): KnownSeverityLevel {
  // https://github.com/pinojs/pino/blob/master/docs/api.md#logger-level
  if (level >= 60) {
    return KnownSeverityLevel.Critical
  }

  if (level >= 50) {
    return KnownSeverityLevel.Error
  }

  if (level >= 40) {
    return KnownSeverityLevel.Warning
  }

  if (level >= 30) {
    return KnownSeverityLevel.Information
  }

  return KnownSeverityLevel.Verbose
}

interface PinoLogObject {
  msg?: string
  time?: number
  level: number
  err?: Error | ErrorLike | string
}

function isPinoLogObject(obj: unknown): obj is PinoLogObject {
  const maybePinoLogObject = obj as PinoLogObject

  return typeof maybePinoLogObject.level !== 'undefined'
}

interface ErrorLike {
  message: string
  stack?: string
  cause?: ErrorLike
}

function isErrorLike(err: unknown): err is ErrorLike {
  const maybeErrorLike = err as ErrorLike

  return typeof maybeErrorLike.message !== 'undefined'
}

function createExceptionTelemetry(obj: PinoLogObject): ExceptionTelemetry {
  const { msg, time, err, level } = obj

  const properties = Object.assign({}, obj)
  delete properties.msg
  delete properties.time
  delete properties.err

  const severity = pinoLevelToSeverityLevel(level)

  const message = msg || severity

  let exception: Error
  if (err) {
    if (err instanceof Error) {
      exception = err
    } else if (isErrorLike(err)) {
      exception = new Error(err.message || message, {
        cause: err.cause
      })
      exception.stack = err.stack
    } else if (typeof err === 'string') {
      exception = new Error(err || message)
    } else {
      exception = new Error(message)
    }
  } else {
    exception = new Error(message)
  }

  let timestamp: Date | undefined
  if (time) {
    timestamp = new Date(time)
  }

  return {
    exception,
    severity,
    properties,
    time: timestamp
  }
}

function createTraceTelemetry(obj: PinoLogObject): TraceTelemetry {
  const { msg, time, level } = obj

  const properties = Object.assign({}, obj)
  delete properties.msg
  delete properties.time

  const severity = pinoLevelToSeverityLevel(level)

  const message = msg || severity

  let timestamp: Date | undefined
  if (time) {
    timestamp = new Date(time)
  }

  return {
    message,
    severity,
    properties,
    time: timestamp
  }
}

let telemetryClient: TelemetryClient | undefined

function initTelemetryClient(options: PinoAppInsightsOptions) {
  if (options.telemetryClient) {
    telemetryClient = options.telemetryClient
  }

  if (options.connectionString) {
    telemetryClient = new TelemetryClient(options.connectionString)
  }
}

interface PinoAppInsightsOptions {
  telemetryClient?: TelemetryClient
  connectionString?: string
  minLevel: number
}

const defaultOptions: PinoAppInsightsOptions = {
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  minLevel: 10
}

// eslint-disable-next-line import/no-anonymous-default-export
export default async function (
  initAppInsightsOptions: Partial<PinoAppInsightsOptions>
) {
  const options = {
    ...defaultOptions,
    ...initAppInsightsOptions
  }

  initTelemetryClient(options)

  return build(async function (source) {
    for await (const obj of source) {
      if (!obj) {
        continue
      }

      if (!isPinoLogObject(obj)) {
        continue
      }

      const { level, err } = obj

      if (level < options.minLevel) {
        continue
      }

      if (!telemetryClient) {
        throw new Error(
          'You must either provide a TelemetryClient instance or a connection string.'
        )
      }

      if (err) {
        telemetryClient.trackException(createExceptionTelemetry(obj))

        continue
      }

      telemetryClient.trackTrace(createTraceTelemetry(obj))
    }
  })
}
