import * as pino from 'pino'
// eslint-disable-next-line import/extensions
import { name } from '../../package.json'

export const initLogger = (opts?: pino.LoggerOptions): pino.Logger => pino({
  name,
  ...(opts ?? {}),
})

export { Logger } from 'pino'
