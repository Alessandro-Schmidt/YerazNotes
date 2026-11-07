#!/usr/bin/env node
// `yeraz` after `npm link`: runs scripts/yeraz.ts through tsx, from any folder.
import { register } from 'tsx/esm/api'

register()
await import('../scripts/yeraz.ts')
