import * as pino from 'pino'
// eslint-disable-next-line import/extensions
import { name } from '../../package.json'

export const initLogger = (opts?: pino.LoggerOptions): pino.Logger => pino({
  name,
  ...opts ?? {},
})

// eslint-disable-next-line no-duplicate-imports
export { Logger } from 'pino'
