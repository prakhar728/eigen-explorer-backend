import type { Request, Response } from 'express'
import type Prisma from '@prisma/client'
import prisma from '../../utils/prismaClient'
import { getEigenContracts } from '../../data/address'
import { handleAndReturnErrorResponse } from '../../schema/errors'
import { getAvsFilterQuery } from '../avs/avsController'
import { HistoricalCountSchema } from '../../schema/zod/schemas/historicalCountQuery'
import { EthereumAddressSchema } from '../../schema/zod/schemas/base/ethereumAddress'
import { fetchCurrentEthPrices } from '../../utils/strategies'

type HistoricalTvlRecord = {
	timestamp: string
	tvlEth: number
}

type MetricModelMap = {
	metricEigenPodsHourly: Prisma.MetricEigenPodsHourly
	metricStrategyHourly: Prisma.MetricStrategyHourly
	metricDepositHourly: Prisma.MetricDepositHourly
	metricWithdrawalHourly: Prisma.MetricWithdrawalHourly
}

type MetricModelName = keyof MetricModelMap

const beaconAddress = '0xbeac0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeebeac0'

/* 
========================
====== All Routes ======
======================== 
*/

// --- Holistic Routes ---

/**
 * Function for route /
 * Returns all TVL metrics & count metrics for AVS, Operator & Stakers
 *
 * @param req
 * @param res
 */
export async function getMetrics(req: Request, res: Response) {
	//TODO: Cleanup
	try {
		const [
			tvlRestaking,
			tvlBeaconChain,
			totalAvs,
			totalOperators,
			totalStakers
		] = await Promise.all([
			doGetTvlRestaking(false),
			doGetTvlBeaconChain(),
			doGetTotalAvsCount(),
			doGetTotalOperatorCount(),
			doGetTotalStakerCount()
		])

		const metrics = {
			tvlRestaking,
			tvlBeaconChain,
			totalAvs,
			totalOperators,
			totalStakers
		}

		res.send({
			tvl:
				(metrics.tvlRestaking ? metrics.tvlRestaking.tvlRestaking.tvl : 0) +
				(metrics.tvlBeaconChain ? metrics.tvlBeaconChain.tvl : 0),
			tvlBeaconChain: metrics.tvlBeaconChain,
			...metrics.tvlRestaking,
			totalAvs: metrics.totalAvs,
			totalOperators: metrics.totalOperators,
			totalStakers: metrics.totalStakers
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- TVL Routes ---

/**
 * Function for route /tvl
 * Returns total EL TVL along with 24h/7d change
 *
 * @param req
 * @param res
 */
export async function getTvl(req: Request, res: Response) {
	try {
		const tvlRestaking = (await doGetTvlRestaking(false)).tvlRestaking
		const tvlBeaconChain = await doGetTvlBeaconChain()

		res.send({
			tvl: tvlRestaking.tvl + tvlBeaconChain.tvl,
			change24h: {
				value: tvlRestaking.change24h.value + tvlBeaconChain.change24h.value,
				percent:
					tvlRestaking.change24h.percent + tvlBeaconChain.change24h.percent
			},
			change7d: {
				value: tvlRestaking.change7d.value + tvlBeaconChain.change7d.value,
				percent: tvlRestaking.change7d.percent + tvlBeaconChain.change7d.percent
			}
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /tvl/beacon-chain
 * Returns Beacon Chain TVL along with 24h/7d change
 *
 * @param req
 * @param res
 */
export async function getTvlBeaconChain(req: Request, res: Response) {
	try {
		const tvlBeaconChain = await doGetTvlBeaconChain()

		res.send({
			tvl: tvlBeaconChain
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /tvl/restaking
 * Returns Liquid Staking TVL along with 24h/7d change
 * Note: This TVL value includes Beacon ETH that's restaked (which is different from TVL Beacon Chain)
 *
 * @param req
 * @param res
 */
export async function getTvlRestaking(req: Request, res: Response) {
	try {
		const tvlRestaking = await doGetTvlRestaking(true)

		res.send({
			tvl: tvlRestaking.tvlRestaking,
			tvlStrategies: tvlRestaking.tvlStrategies,
			tvlStrategiesEth: tvlRestaking.tvlStrategiesEth
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /tvl/restaking/:strategy
 * Returns strategy TVL along with 24h/7d change for any given strategy address
 *
 * @param req
 * @param res
 */
export async function getTvlRestakingByStrategy(req: Request, res: Response) {
	try {
		const { strategy } = req.params

		if (!strategy) {
			throw new Error('Invalid strategy name.')
		}

		const strategies = Object.keys(getEigenContracts().Strategies)
		const foundStrategy = strategies.find(
			(s) => s.toLowerCase() === strategy.toLowerCase()
		)

		if (!foundStrategy) {
			throw new Error('Invalid strategy.')
		}

		const tvl = await doGetTvlRestaking(
			true,
			getEigenContracts().Strategies[foundStrategy].strategyContract
		)

		res.send({
			...tvl
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- Total Routes ---

/**
 * Function for route /total-avs
 * Returns number of whitelisted AVSs along with 24h/7d change
 *
 * @param req
 * @param res
 */
export async function getTotalAvs(req: Request, res: Response) {
	try {
		const total = await doGetTotalAvsCount()

		res.send(total)
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /total-operators
 * Returns number of Operators along with 24h/7d change
 *
 * @param req
 * @param res
 */
export async function getTotalOperators(req: Request, res: Response) {
	try {
		const total = await doGetTotalOperatorCount()

		res.send(total)
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /total-stakers
 * Returns number of Stakers along with 24h/7d change
 *
 * @param req
 * @param res
 */
export async function getTotalStakers(req: Request, res: Response) {
	try {
		const total = await doGetTotalStakerCount()

		res.send(total)
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /total-withdrawals
 * Returns number total, pending and completed Withdrawals
 *
 * @param req
 * @param res
 */
export async function getTotalWithdrawals(req: Request, res: Response) {
	try {
		const total = await doGetTotalWithdrawals()

		res.send(total)
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /total-deposits
 * Returns number total Deposits
 *
 * @param req
 * @param res
 */
export async function getTotalDeposits(req: Request, res: Response) {
	try {
		const total = await doGetTotalDeposits()

		res.send({
			total
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- Historical TVL Routes ---

/**
 * Function for route /historical/tvl
 * Returns total EL TVL in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalTvl(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalTvlTotal(
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/tvl/beacon-chain
 * Returns total Beacon Chain TVL in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalTvlBeaconChain(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalTvlBeacon(
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/restaking/:address
 * Returns Liquid Staking TVL for a given strategy in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalTvlRestaking(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}
	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { address } = req.params
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalTvlRestaking(
			startAt,
			endAt,
			frequency,
			variant,
			address
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/withdrawals
 * Returns completed withdrawals TVL (net outflow from EL) in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalTvlWithdrawal(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalTvlWithdrawalDeposit(
			'withdrawalMetricHourly' as MetricModelName,
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/deposits
 * Returns deposits TVL in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalTvlDeposit(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalTvlWithdrawalDeposit(
			'depositMetricHourly' as MetricModelName,
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- Historical Aggregate Routes ---

/**
 * Function for route /historical/avs/:address
 * Returns TVL in ETH, totalOperators and totalStakers for a given whitelisted AVS in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalAvsAggregate(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { address } = req.params
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalAvsAggregate(
			address,
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/operators/:address
 * Returns TVL in ETH, totalAvs and totalStakers for a given Operator in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalOperatorsAggregate(
	req: Request,
	res: Response
) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { address } = req.params
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalOperatorsAggregate(
			address,
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- Historical Count Routes ---

/**
 * Function for route /historical/count-avs
 * Returns total number of whitelisted AVSs in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalAvsCount(req: Request, res: Response) {
	const paramCheck = HistoricalCountSchema.safeParse(req.query)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = paramCheck.data
		const data = await doGetHistoricalCount(
			'avs',
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/count-operators
 * Returns total number of Operators in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalOperatorCount(req: Request, res: Response) {
	const paramCheck = HistoricalCountSchema.safeParse(req.query)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = paramCheck.data
		const data = await doGetHistoricalCount(
			'operator',
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/count-stakers
 * Returns total number of Stakers in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalStakerCount(req: Request, res: Response) {
	const paramCheck = HistoricalCountSchema.safeParse(req.query)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = paramCheck.data
		const data = await doGetHistoricalCount(
			'staker',
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/count-withdrawals
 * Returns total number of queued withdrawals in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalWithdrawalCount(
	req: Request,
	res: Response
) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalCount(
			'withdrawalQueued',
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /historical/count-deposits
 * Returns total number of deposits in historical format
 *
 * @param req
 * @param res
 */
export async function getHistoricalDepositCount(req: Request, res: Response) {
	const queryCheck = HistoricalCountSchema.safeParse(req.query)
	if (!queryCheck.success) {
		return handleAndReturnErrorResponse(req, res, queryCheck.error)
	}

	try {
		const { frequency, variant, startAt, endAt } = queryCheck.data
		const data = await doGetHistoricalCount(
			'deposit',
			startAt,
			endAt,
			frequency,
			variant
		)
		res.status(200).send({ data })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/*
============================
=== Processing Functions ===
============================
*/

// --- TVL Routes ---

/**
 * Processes total restaking TVL, 24h/7d change and individual strategy TVLs, with the option to restrict to 1 strategy
 * Optionally, can choose to exclude restaked Beacon ETH in total TVL calc (done in getTvl() where total Beacon Chain ETH is considered instead)
 * Used by getMetrics(), getTvl() & getTvlRestaking()
 *
 * @param strategy
 * @param excludeBeaconFromTvl
 * @returns
 */
async function doGetTvlRestaking(includeBeaconInTvl = true, strategy?: string) {
	const timeOffsets = ['', '24h', '7d']
	const [strategyRecords, strategyPriceMap] = await Promise.all([
		fetchLatestStrategyData(strategy),
		fetchCurrentEthPrices()
	])

	const {
		totalTvl,
		totalTvl24hOffset,
		totalTvl7dOffset,
		tvlStrategies,
		tvlStrategiesEth
	} = Object.entries(strategyRecords).reduce(
		(acc, [strategyAddress, records]) => {
			const ethPrice = strategyPriceMap.get(strategyAddress) || 0
			const addToTvl = includeBeaconInTvl || strategyAddress !== beaconAddress // Only use Beacon TVL in total TVL & change calc if required

			records.forEach((record, index) => {
				const tvlEth = Number(record.tvl) * ethPrice
				if (index === 0) {
					if (addToTvl) acc.totalTvl += tvlEth
					acc.tvlStrategies[strategyAddress] = Number(record.tvl)
					acc.tvlStrategiesEth[strategyAddress] = tvlEth
				} else if (index === 1 && addToTvl) {
					acc.totalTvl24hOffset += tvlEth
				} else if (index === 2 && addToTvl) {
					acc.totalTvl7dOffset += tvlEth
				}
			})

			return acc
		},
		{
			totalTvl: 0,
			totalTvl24hOffset: 0,
			totalTvl7dOffset: 0,
			tvlStrategies: {},
			tvlStrategiesEth: {}
		}
	)

	return {
		tvlRestaking: calculateTvlChanges(
			totalTvl,
			totalTvl24hOffset,
			totalTvl7dOffset
		),
		tvlStrategies,
		tvlStrategiesEth
	}

	// Function to get restaking data for each timeOffset for all relevant strategies
	async function fetchLatestStrategyData(strategy?: string) {
		const exactTimestamps = await prisma.metricStrategyHourly.groupBy({
			by: ['strategyAddress'],
			_max: {
				timestamp: true
			},
			where: {
				AND: [
					strategy ? { strategyAddress: strategy } : {},
					{
						OR: timeOffsets.map((tf) => ({
							timestamp: { lte: getTimestamp(tf) }
						}))
					}
				]
			}
		})

		const strategyRecords = await prisma.metricStrategyHourly.findMany({
			where: {
				OR: exactTimestamps.flatMap((lt) =>
					timeOffsets.map((tf) => ({
						strategyAddress: lt.strategyAddress,
						timestamp: {
							lte: getTimestamp(tf),
							...(lt._max.timestamp ? { gte: lt._max.timestamp } : {})
						}
					}))
				)
			},
			orderBy: [{ strategyAddress: 'asc' }, { timestamp: 'desc' }]
		})

		return strategyRecords.reduce(
			(acc, record) => {
				if (!acc[record.strategyAddress]) {
					acc[record.strategyAddress] = []
				}
				acc[record.strategyAddress].push(record)
				return acc
			},
			{} as Record<string, typeof strategyRecords>
		)
	}
}

/**
 * Processes total TVL and 24h/7d change for Beacon Chain ETH
 * Used by getMetrics() & getBeaconChainTvl()
 *
 * @returns
 */
async function doGetTvlBeaconChain() {
	const timeOffsets = ['', '24h', '7d']

	const beaconRecords = await prisma.metricEigenPodsHourly.findMany({
		where: {
			OR: timeOffsets.map((tf) => ({
				timestamp: { lte: getTimestamp(tf) }
			}))
		},
		orderBy: { timestamp: 'desc' },
		take: 3
	})

	const [currentTvl, tvl24hOffset, tvl7dOffset] = beaconRecords.map((record) =>
		Number(record?.tvlEth ?? 0)
	)

	return calculateTvlChanges(currentTvl, tvl24hOffset, tvl7dOffset)
}

// --- Total Routes ---

async function doGetTotalAvsCount() {
	const timestampNow = new Date()
	const timestamp24h = new Date(
		new Date().setUTCHours(timestampNow.getUTCHours() - 24)
	)
	const timestamp7d = new Date(
		new Date().setUTCDate(timestampNow.getUTCDate() - 7)
	)

	const totalNow = await prisma.avs.count({
		where: getAvsFilterQuery(true)
	})
	const change24hValue = await prisma.avs.count({
		where: {
			createdAt: { gte: timestamp24h },
			...getAvsFilterQuery(true)
		}
	})
	const change7dValue = await prisma.avs.count({
		where: {
			createdAt: { gte: timestamp7d },
			...getAvsFilterQuery(true)
		}
	})

	const change24hPercent =
		change24hValue !== 0
			? Math.round((change24hValue / (totalNow - change24hValue)) * 1000) / 1000
			: 0

	const change7dPercent =
		change7dValue !== 0
			? Math.round((change7dValue / (totalNow - change7dValue)) * 1000) / 1000
			: 0

	return {
		total: totalNow,
		change24h: {
			value: change24hValue,
			percent: change24hPercent
		},
		change7d: {
			value: change7dValue,
			percent: change7dPercent
		}
	}
}

async function doGetTotalOperatorCount() {
	const timestampNow = new Date()
	const timestamp24h = new Date(
		new Date().setUTCHours(timestampNow.getUTCHours() - 24)
	)
	const timestamp7d = new Date(
		new Date().setUTCDate(timestampNow.getUTCDate() - 7)
	)

	const totalNow = await prisma.operator.count()
	const change24hValue = await prisma.operator.count({
		where: {
			createdAt: { gte: timestamp24h }
		}
	})
	const change7dValue = await prisma.operator.count({
		where: {
			createdAt: { gte: timestamp7d }
		}
	})

	const change24hPercent =
		change24hValue !== 0
			? Math.round((change24hValue / (totalNow - change24hValue)) * 1000) / 1000
			: 0

	const change7dPercent =
		change7dValue !== 0
			? Math.round((change7dValue / (totalNow - change7dValue)) * 1000) / 1000
			: 0

	return {
		total: totalNow,
		change24h: {
			value: change24hValue,
			percent: change24hPercent
		},
		change7d: {
			value: change7dValue,
			percent: change7dPercent
		}
	}
}

async function doGetTotalStakerCount() {
	const timestampNow = new Date()
	const timestamp24h = new Date(
		new Date().setUTCHours(timestampNow.getUTCHours() - 24)
	)
	const timestamp7d = new Date(
		new Date().setUTCDate(timestampNow.getUTCDate() - 7)
	)

	const totalNow = await prisma.staker.count({
		where: { operatorAddress: { not: null } }
	})
	const change24hValue = await prisma.staker.count({
		where: {
			createdAt: { gte: timestamp24h },
			operatorAddress: { not: null }
		}
	})
	const change7dValue = await prisma.staker.count({
		where: {
			createdAt: { gte: timestamp7d },
			operatorAddress: { not: null }
		}
	})

	const change24hPercent =
		change24hValue !== 0
			? Math.round((change24hValue / (totalNow - change24hValue)) * 1000) / 1000
			: 0

	const change7dPercent =
		change7dValue !== 0
			? Math.round((change7dValue / (totalNow - change7dValue)) * 1000) / 1000
			: 0

	return {
		total: totalNow,
		change24h: {
			value: change24hValue,
			percent: change24hPercent
		},
		change7d: {
			value: change7dValue,
			percent: change7dPercent
		}
	}
}

async function doGetTotalWithdrawals() {
	const total = await prisma.withdrawalQueued.count()
	const completed = await prisma.withdrawalCompleted.count()
	const pending = total - completed

	return {
		total,
		pending,
		completed
	}
}

async function doGetTotalDeposits() {
	const deposits = await prisma.deposit.count()

	return deposits
}

// --- Historical TVL Routes ---

/**
 * Processes total TVL in historical format
 * Calculates total TVL by combining historical total Beacon Chain ETH TVL with restaking TVL (without restaked Beacon Chain ETH)
 *
 * @param startAt
 * @param endAt
 * @param frequency
 * @param variant
 */
async function doGetHistoricalTvlTotal(
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	// Get historical tvl data for Beacon Chain ETH and LSTs (excluding restaked Beacon Chain ETH)
	const [beaconTvl, restakingTvl] = await Promise.all([
		doGetHistoricalTvlBeacon(startAt, endAt, frequency, variant),
		doGetHistoricalTvlRestaking(
			startAt,
			endAt,
			frequency,
			variant,
			undefined,
			false
		)
	])

	// Combine the results
	const results = beaconTvl.map((beaconEntry, index) => {
		const restakingEntry = restakingTvl[index]
		if (!restakingEntry || beaconEntry.timestamp !== restakingEntry.timestamp) {
			throw new Error(`Mismatch in historical data at index ${index}`)
		}

		return {
			timestamp: beaconEntry.timestamp,
			tvlEth: beaconEntry.tvlEth + restakingEntry.tvlEth
		}
	})

	return results as HistoricalTvlRecord[]
}

/**
 * Processes total Beacon Chain ETH TVL in historical format
 *
 * @param startAt
 * @param endAt
 * @param frequency
 * @param variant
 */
async function doGetHistoricalTvlBeacon(
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	const startTimestamp = resetTime(new Date(startAt))
	const endTimestamp = resetTime(new Date(endAt))

	const hourlyData = await prisma.metricEigenPodsHourly.findMany({
		where: {
			timestamp: {
				gte: startTimestamp,
				lte: endTimestamp
			}
		},
		orderBy: {
			timestamp: 'asc'
		}
	})

	const results: HistoricalTvlRecord[] = []
	const modelName = 'metricEigenPodsHourly' as MetricModelName

	// MetricHourly records are created only when there is activity detected. If cumulative, we may need to set initial tvl value
	let tvlEth =
		variant === 'cumulative'
			? await getInitialTvlCumulative(
					startTimestamp,
					hourlyData,
					true,
					modelName,
					undefined
			  )
			: 0

	const offset = getOffsetInMs(frequency)
	let currentTimestamp = startTimestamp

	while (currentTimestamp <= endTimestamp) {
		const nextTimestamp = new Date(currentTimestamp.getTime() + offset)
		const intervalData = hourlyData.filter(
			(data) =>
				data.timestamp >= currentTimestamp && data.timestamp < nextTimestamp
		)

		tvlEth = calculateTvlForHistoricalRecord(
			intervalData,
			variant,
			tvlEth,
			true,
			undefined
		)

		results.push({
			timestamp: new Date(Number(currentTimestamp)).toISOString(),
			tvlEth
		})

		currentTimestamp = nextTimestamp
	}

	return results
}

/**
 * Processes restaking TVL in historical format with option
 * Calculates total TVL using restaked Beacon Chain ETH, not total Beacon Chain ETH
 *
 * @param startAt
 * @param endAt
 * @param frequency
 * @param variant
 */
async function doGetHistoricalTvlRestaking(
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string,
	address?: string,
	includeBeaconInTvl = true
) {
	const startTimestamp = resetTime(new Date(startAt))
	const endTimestamp = resetTime(new Date(endAt))

	const hourlyData = await prisma.metricStrategyHourly.findMany({
		where: {
			timestamp: {
				gte: startTimestamp,
				lte: endTimestamp
			},
			...(address && { strategyAddress: address.toLowerCase() }),
			...(!includeBeaconInTvl && { strategyAddress: { not: beaconAddress } })
		},
		orderBy: {
			timestamp: 'asc'
		}
	})

	const results: HistoricalTvlRecord[] = []
	const modelName = 'metricStrategyHourly' as MetricModelName
	const ethPrices = await fetchCurrentEthPrices()

	// MetricHourly records are created only when there is activity detected. If cumulative, we may need to set the initial tvl value
	let tvlEth =
		variant === 'cumulative'
			? await getInitialTvlCumulative(
					startTimestamp,
					hourlyData,
					false,
					modelName,
					ethPrices
			  )
			: 0

	const offset = getOffsetInMs(frequency)
	let currentTimestamp = startTimestamp

	while (currentTimestamp <= endTimestamp) {
		const nextTimestamp = new Date(currentTimestamp.getTime() + offset)
		const intervalData = hourlyData.filter(
			(data) =>
				data.timestamp >= currentTimestamp && data.timestamp < nextTimestamp
		)

		tvlEth = calculateTvlForHistoricalRecord(
			intervalData,
			variant,
			tvlEth,
			false,
			ethPrices
		)

		results.push({
			timestamp: new Date(Number(currentTimestamp)).toISOString(),
			tvlEth
		})

		currentTimestamp = nextTimestamp
	}

	return results
}

/**
 * Processes withdrawals/deposits TVL in historical format
 *
 * @param startAt
 * @param endAt
 * @param frequency
 * @param variant
 * @returns
 */
async function doGetHistoricalTvlWithdrawalDeposit(
	modelName: MetricModelName,
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	const startTimestamp = resetTime(new Date(startAt))
	const endTimestamp = resetTime(new Date(endAt))

	const hourlyData = await prisma.metricDepositHourly.findMany({
		where: {
			timestamp: {
				gte: startTimestamp,
				lte: endTimestamp
			}
		},
		orderBy: {
			timestamp: 'asc'
		}
	})

	const results: HistoricalTvlRecord[] = []

	// MetricHourly records are created only when there is activity detected. If cumulative, we may need to set initial tvl value
	let tvlEth =
		variant === 'cumulative'
			? await getInitialTvlCumulative(
					startTimestamp,
					hourlyData,
					true,
					modelName,
					undefined
			  )
			: 0

	const offset = getOffsetInMs(frequency)
	let currentTimestamp = startTimestamp

	while (currentTimestamp <= endTimestamp) {
		const nextTimestamp = new Date(currentTimestamp.getTime() + offset)
		const intervalData = hourlyData.filter(
			(data) =>
				data.timestamp >= currentTimestamp && data.timestamp < nextTimestamp
		)

		tvlEth = calculateTvlForHistoricalRecord(
			intervalData,
			variant,
			tvlEth,
			true,
			undefined
		)

		results.push({
			timestamp: new Date(Number(currentTimestamp)).toISOString(),
			tvlEth
		})

		currentTimestamp = nextTimestamp
	}

	return results
}

// --- Historical Aggregate Routes ---

async function doGetHistoricalAvsAggregate(
	address: string,
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	const startTimestamp = resetTime(new Date(startAt))
	const endTimestamp = resetTime(new Date(endAt))
	let currentTimestamp = startTimestamp

	const results: {
		timestamp: string
		tvlEth: number
		totalStakers: number
		totalOperators: number
	}[] = []
	const timeInterval =
		{
			'1h': 3600000,
			'1d': 86400000,
			'7d': 604800000
		}[frequency] || 3600000

	const hourlyData = await prisma.metricAvsHourly.findMany({
		where: {
			timestamp: {
				gte: startTimestamp,
				lte: endTimestamp
			},
			avsAddress: address.toLowerCase()
		},
		orderBy: {
			timestamp: 'asc'
		}
	})

	let tvlEth = 0
	let totalStakers = 0
	let totalOperators = 0

	// Set the first tvlEth, totalStakers & totalOperators value to prevent the first n responses returning 0 in case no records exist for the first n timestamps
	if (variant === 'cumulative') {
		if (
			hourlyData.length > 0 &&
			hourlyData[0].timestamp.getTime() === startTimestamp.getTime()
		) {
			tvlEth = Number(hourlyData[0].tvlEth)
			totalStakers = hourlyData[0].totalStakers
			totalOperators = hourlyData[0].totalOperators
		} else {
			const result = await prisma.metricAvsHourly.findFirst({
				select: {
					tvlEth: true,
					totalStakers: true,
					totalOperators: true
				},
				where: {
					timestamp: {
						lt: startTimestamp
					},
					avsAddress: address.toLowerCase()
				},
				orderBy: {
					timestamp: 'desc'
				}
			})

			tvlEth = result ? Number(result.tvlEth) : 0
			totalStakers = result ? Number(result.totalStakers) : 0
			totalOperators = result ? Number(result.totalOperators) : 0
		}
	}

	while (currentTimestamp <= endTimestamp) {
		const nextTimestamp = new Date(currentTimestamp.getTime() + timeInterval)
		const intervalData = hourlyData.filter(
			(data) =>
				data.timestamp >= currentTimestamp && data.timestamp < nextTimestamp
		)

		if (variant === 'cumulative') {
			if (intervalData.length > 0) {
				tvlEth = Number(intervalData[intervalData.length - 1].tvlEth)
				totalStakers = intervalData[intervalData.length - 1].totalStakers
				totalOperators = intervalData[intervalData.length - 1].totalOperators
			} // If no records exist in the time period, previous tvlEth, totalStakers & totalOperators value is returned
		} else {
			tvlEth = intervalData.reduce((sum, record) => {
				return sum + Number(record.changeTvlEth)
			}, 0)

			totalStakers = intervalData.reduce((sum, record) => {
				return sum + record.changeStakers
			}, 0)

			totalOperators = intervalData.reduce((sum, record) => {
				return sum + record.changeOperators
			}, 0)
		}

		results.push({
			timestamp: new Date(Number(currentTimestamp)).toISOString(),
			tvlEth,
			totalStakers,
			totalOperators
		})

		currentTimestamp = nextTimestamp
	}

	return results
}

async function doGetHistoricalOperatorsAggregate(
	address: string,
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	const startTimestamp = resetTime(new Date(startAt))
	const endTimestamp = resetTime(new Date(endAt))
	let currentTimestamp = startTimestamp

	const results: {
		timestamp: string
		tvlEth: number
		totalStakers: number
	}[] = []
	const timeInterval =
		{
			'1h': 3600000,
			'1d': 86400000,
			'7d': 604800000
		}[frequency] || 3600000

	const hourlyData = await prisma.metricOperatorHourly.findMany({
		where: {
			timestamp: {
				gte: startTimestamp,
				lte: endTimestamp
			},
			operatorAddress: address.toLowerCase()
		},
		orderBy: {
			timestamp: 'asc'
		}
	})

	let tvlEth = 0
	let totalStakers = 0

	// Set the first tvlEth & totalStakers value to prevent the first n responses returning 0 in case no records exist for the first n timestamps
	if (variant === 'cumulative') {
		if (
			hourlyData.length > 0 &&
			hourlyData[0].timestamp.getTime() === startTimestamp.getTime()
		) {
			tvlEth = Number(hourlyData[0].tvlEth)
			totalStakers = hourlyData[0].totalStakers
		} else {
			const result = await prisma.metricOperatorHourly.findFirst({
				select: {
					tvlEth: true,
					totalStakers: true
				},
				where: {
					timestamp: {
						lt: startTimestamp
					},
					operatorAddress: address.toLowerCase()
				},
				orderBy: {
					timestamp: 'desc'
				}
			})

			tvlEth = result ? Number(result.tvlEth) : 0
			totalStakers = result ? Number(result.totalStakers) : 0
		}
	}

	while (currentTimestamp <= endTimestamp) {
		const nextTimestamp = new Date(currentTimestamp.getTime() + timeInterval)
		const intervalData = hourlyData.filter(
			(data) =>
				data.timestamp >= currentTimestamp && data.timestamp < nextTimestamp
		)

		if (variant === 'cumulative') {
			if (intervalData.length > 0) {
				tvlEth = Number(intervalData[intervalData.length - 1].tvlEth)
				totalStakers = intervalData[intervalData.length - 1].totalStakers
			} // If no records exist in the time period, previous tvlEth & totalStakers value is returned
		} else {
			tvlEth = intervalData.reduce((sum, record) => {
				return sum + Number(record.changeTvlEth)
			}, 0)

			totalStakers = intervalData.reduce((sum, record) => {
				return sum + record.changeStakers
			}, 0)
		}

		results.push({
			timestamp: new Date(Number(currentTimestamp)).toISOString(),
			tvlEth,
			totalStakers
		})

		currentTimestamp = nextTimestamp
	}

	return results
}

// --- Historical Count Routes ---

async function doGetHistoricalCount(
	modelName: string,
	startAt: string,
	endAt: string,
	frequency: string,
	variant: string
) {
	if (
		!['avs', 'operator', 'staker', 'withdrawalQueued', 'deposit'].includes(
			modelName
		)
	) {
		throw new Error('Invalid model name')
	}

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const model = prisma[modelName] as any

	const startDate = resetTime(new Date(startAt))
	const endDate = resetTime(new Date(endAt))

	const initialTally = await model.count({
		where: {
			createdAt: {
				lt: startDate
			}
		}
	})

	const modelData = await model.findMany({
		select: {
			createdAt: true
		},
		where: {
			createdAt: {
				gte: startDate,
				lte: endDate
			}
		},
		orderBy: {
			createdAt: 'asc'
		}
	})

	const results: { timestamp: string; value: number }[] = []
	const timeInterval =
		{
			'1h': 3600000,
			'1d': 86400000,
			'7d': 604800000
		}[frequency] || 3600000
	let currentDate = startDate
	let tally = initialTally

	while (currentDate <= endDate) {
		const nextDate = new Date(currentDate.getTime() + timeInterval)

		const intervalData = modelData.filter(
			(data) => data.createdAt >= currentDate && data.createdAt < nextDate
		)

		if (variant === 'discrete') {
			results.push({
				timestamp: new Date(Number(currentDate)).toISOString(),
				value: intervalData.length
			})
		} else {
			tally += intervalData.length
			results.push({
				timestamp: new Date(Number(currentDate)).toISOString(),
				value: tally
			})
		}

		currentDate = nextDate
	}

	return results
}

/*
=========================
=== Utility Functions ===
=========================
*/

/**
 * Retrieves a Date object set to now or in the past basis an offset
 *
 * @param offset
 * @returns
 */
function getTimestamp(offset?: string) {
	switch (offset) {
		case '24h': {
			const now = new Date()
			return new Date(new Date().setUTCHours(now.getUTCHours() - 24))
		}
		case '7d': {
			const now = new Date()
			return new Date(new Date().setUTCDate(now.getUTCDate() - 7))
		}
		default:
			return new Date()
	}
}

/**
 * Returns offset values to calcuate consecutive timestamps in historical routes
 *
 * @param frequency
 * @returns
 */
function getOffsetInMs(frequency: string) {
	switch (frequency) {
		case '1h':
			return 3600000
		case '1d':
			return 86400000
		case '7d':
			return 604800000
		default:
			return 3600000
	}
}

/**
 * Sets any date to the beginning of the hour
 *
 * @param date
 * @returns
 */
function resetTime(date: Date) {
	date.setUTCMinutes(0, 0, 0)
	return date
}

/**
 * Calculates 24h/7d change and returns according to historical format
 *
 * @param currentTvl
 * @param tvl24hOffset
 * @param tvl7dOffset
 * @returns
 */
function calculateTvlChanges(
	currentTvl: number,
	tvl24hOffset: number,
	tvl7dOffset: number
) {
	return {
		tvl: currentTvl,
		change24h: {
			value: currentTvl - tvl24hOffset,
			percent:
				tvl24hOffset === 0 ? 0 : (currentTvl - tvl24hOffset) / tvl24hOffset
		},
		change7d: {
			value: currentTvl - tvl7dOffset,
			percent: tvl7dOffset === 0 ? 0 : (currentTvl - tvl7dOffset) / tvl7dOffset
		}
	}
}

/**
 * Calculates initial tvlEth for a historical tvl query with variant set to cumulative
 *
 * @param startTimestamp
 * @param hourlyData
 * @param isEthDenominated
 * @param modelName
 * @param ethPrices
 * @returns
 */
async function getInitialTvlCumulative<T extends MetricModelName>(
	startTimestamp: Date,
	hourlyData: MetricModelMap[T][],
	isEthDenominated: boolean,
	modelName: T,
	ethPrices?: Map<string, number>
) {
	if (!isEthDenominated && !ethPrices) {
		throw new Error('ETH prices are required for non-beacon calculations')
	}

	if (
		hourlyData.length > 0 &&
		hourlyData[0].timestamp.getTime() === startTimestamp.getTime()
	) {
		if (isEthDenominated) {
			return Number(
				(hourlyData[0] as MetricModelMap[Exclude<T, 'metricStrategyHourly'>])
					.tvlEth
			)
		}

		const strategyRecord = hourlyData[0] as Prisma.MetricStrategyHourly
		return (
			Number(strategyRecord.tvl) *
			(ethPrices?.get(strategyRecord.strategyAddress) || 0)
		)
	}

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const model = prisma[modelName] as any
	const result = await model.findFirst({
		select: { [isEthDenominated ? 'tvlEth' : 'tvl']: true },
		where: { timestamp: { lt: startTimestamp } },
		orderBy: { timestamp: 'desc' }
	})

	if (!result) return 0

	return isEthDenominated
		? Number(result.tvlEth)
		: Number(result.tvl) * (ethPrices?.get(beaconAddress) || 0)
}

/**
 * Calculates tvlEth for one record of a historical tvl response
 *
 * @param intervalData
 * @param variant
 * @param previousTvl
 * @param isEthDenominated
 * @param ethPrices
 * @returns
 */
function calculateTvlForHistoricalRecord<T extends MetricModelName>(
	intervalData: MetricModelMap[T][],
	variant: string,
	previousTvl: number,
	isEthDenominated: boolean,
	ethPrices?: Map<string, number>
): number {
	if (!isEthDenominated && !ethPrices) {
		throw new Error('ETH prices are required for non-beacon calculations')
	}

	if (variant === 'cumulative') {
		if (intervalData.length > 0) {
			const lastRecord = intervalData[intervalData.length - 1]
			if (isEthDenominated) {
				return Number(
					(lastRecord as MetricModelMap[Exclude<T, 'metricStrategyHourly'>])
						.tvlEth
				)
			}

			const strategyRecord = lastRecord as Prisma.MetricStrategyHourly
			return (
				Number(strategyRecord.tvl) *
				(ethPrices?.get(strategyRecord.strategyAddress) || 0)
			)
		}
		return previousTvl // If no records exist in the time period, previous tvl value is returned
	}

	return intervalData.reduce((sum, record) => {
		if (isEthDenominated) {
			const intervalRecord = record as MetricModelMap[Exclude<
				T,
				'metricStrategyHourly'
			>]
			return sum + Number(intervalRecord.changeTvlEth)
		}
		const strategyRecord = record as Prisma.MetricStrategyHourly
		const ethPrice = ethPrices?.get(strategyRecord.strategyAddress) || 0
		return sum + Number(strategyRecord.changeTvl) * ethPrice
	}, 0)
}
