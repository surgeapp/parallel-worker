import * as pino from 'pino'
// eslint-disable-next-line import/extensions
import { name } from '../../package.json'

const logger = pino({
  name,
})

export default logger
