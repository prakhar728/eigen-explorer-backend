import express from 'express'
import { getAllAVS, getAVS, getTotalNumOfAVS } from './avsController'

const router = express.Router()

// API routes for /avs
router.get('/count', getTotalNumOfAVS)
router.get('/', getAllAVS)
router.get('/:id', getAVS)

export default router
