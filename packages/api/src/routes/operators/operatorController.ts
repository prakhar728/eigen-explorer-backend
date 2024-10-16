import type { Request, Response } from 'express'
import {
	type EigenStrategiesContractAddress,
	getEigenContracts
} from '../../data/address'
import { PaginationQuerySchema } from '../../schema/zod/schemas/paginationQuery'
import { EthereumAddressSchema } from '../../schema/zod/schemas/base/ethereumAddress'
import { WithTvlQuerySchema } from '../../schema/zod/schemas/withTvlQuery'
import { WithAdditionalDataQuerySchema } from '../../schema/zod/schemas/withAdditionalDataQuery'
import { SortByQuerySchema } from '../../schema/zod/schemas/sortByQuery'
import { SearchByTextQuerySchema } from '../../schema/zod/schemas/searchByTextQuery'
import { WithRewardsQuerySchema } from '../../schema/zod/schemas/withRewardsQuery'
import { handleAndReturnErrorResponse } from '../../schema/errors'
import {
	fetchRewardTokenPrices,
	fetchStrategyTokenPrices
} from '../../utils/tokenPrices'
import {
	getStrategiesWithShareUnderlying,
	sharesToTVL,
	sharesToTVLEth
} from '../strategies/strategiesController'
import { withOperatorShares } from '../avs/avsController'
import { getNetwork } from '../../viem/viemClient'
import { holesky } from 'viem/chains'
import Prisma from '@prisma/client'
import prisma from '../../utils/prismaClient'

/**
 * Function for route /operators
 * Returns a list of all Operators with optional sorts & text search
 *
 * @param req
 * @param res
 */
export async function getAllOperators(req: Request, res: Response) {
	// Validate pagination query
	const result = PaginationQuerySchema.and(WithTvlQuerySchema)
		.and(SortByQuerySchema)
		.and(SearchByTextQuerySchema)
		.safeParse(req.query)
	if (!result.success) {
		return handleAndReturnErrorResponse(req, res, result.error)
	}
	const {
		skip,
		take,
		withTvl,
		sortByTvl,
		sortByTotalStakers,
		sortByTotalAvs,
		sortByApy,
		searchByText
	} = result.data

	const searchFilterQuery = getOperatorSearchQuery(
		searchByText,
		'contains',
		'partial'
	)

	try {
		// Setup sort if applicable
		const sortConfig = sortByTotalStakers
			? { field: 'totalStakers', order: sortByTotalStakers }
			: sortByTotalAvs
			  ? { field: 'totalAvs', order: sortByTotalAvs }
			  : sortByTvl
				  ? { field: 'tvlEth', order: sortByTvl }
				  : sortByApy
				  	?{ field: 'apy', order: sortByApy }
					: null

		// Fetch records and apply search/sort
		const operatorRecords = await prisma.operator.findMany({
			where: {
				...searchFilterQuery
			},
			include: {
				avs: {
					select: { avsAddress: true, isActive: true }
				},
				shares: {
					select: { strategyAddress: true, shares: true }
				}
			},
			orderBy: sortConfig
				? { [sortConfig.field]: sortConfig.order }
				: searchByText
				  ? { tvlEth: 'desc' }
				  : undefined,
			skip,
			take
		})

		// Count records
		const operatorCount = await prisma.operator.count({
			where: {
				...searchFilterQuery
			}
		})

		const strategyTokenPrices = withTvl ? await fetchStrategyTokenPrices() : {}
		const strategiesWithSharesUnderlying = withTvl
			? await getStrategiesWithShareUnderlying()
			: []

		const operators = operatorRecords.map((operator) => ({
			...operator,
			avsRegistrations: operator.avs,
			totalStakers: operator.totalStakers,
			totalAvs: operator.totalAvs,
			tvl: withTvl
				? sharesToTVL(
						operator.shares,
						strategiesWithSharesUnderlying,
						strategyTokenPrices
				  )
				: undefined,
			metadataUrl: undefined,
			isMetadataSynced: undefined,
			avs: undefined,
			tvlEth: undefined,
			sharesHash: undefined
		}))

		res.send({
			data: operators,
			meta: {
				total: operatorCount,
				skip,
				take
			}
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /operators/:address
 * Returns a single Operator by address
 *
 * @param req
 * @param res
 */
export async function getOperator(req: Request, res: Response) {
	// Validate pagination query
	const result = WithTvlQuerySchema.and(WithAdditionalDataQuerySchema)
		.and(WithRewardsQuerySchema)
		.safeParse(req.query)
	if (!result.success) {
		return handleAndReturnErrorResponse(req, res, result.error)
	}

	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	const { withTvl, withAvsData, withRewards } = result.data

	try {
		const { address } = req.params

		const operator = await prisma.operator.findUniqueOrThrow({
			where: { address: address.toLowerCase() },
			include: {
				avs: {
					select: {
						avsAddress: true,
						isActive: true,
						...(withAvsData || withRewards
							? {
									avs: {
										select: {
											...(withAvsData
												? {
														metadataUrl: true,
														metadataName: true,
														metadataDescription: true,
														metadataDiscord: true,
														metadataLogo: true,
														metadataTelegram: true,
														metadataWebsite: true,
														metadataX: true,
														curatedMetadata: true,
														restakeableStrategies: true,
														totalStakers: true,
														totalOperators: true,
														tvlEth: true,
														createdAtBlock: true,
														updatedAtBlock: true,
														createdAt: true,
														updatedAt: true
												  }
												: {}),
											...(withRewards
												? {
														address: true,
														rewardSubmissions: true,
														restakeableStrategies: true,
														operators: {
															where: { isActive: true },
															include: {
																operator: {
																	include: {
																		shares: true
																	}
																}
															}
														}
												  }
												: {})
										}
									}
							  }
							: {})
					}
				},
				shares: { select: { strategyAddress: true, shares: true } }
			}
		})

		const avsRegistrations = operator.avs.map((registration) => ({
			avsAddress: registration.avsAddress,
			isActive: registration.isActive,
			...(withAvsData && registration.avs ? registration.avs : {})
		}))

		const strategyTokenPrices = withTvl ? await fetchStrategyTokenPrices() : {}
		const strategiesWithSharesUnderlying = withTvl
			? await getStrategiesWithShareUnderlying()
			: []

		res.send({
			...operator,
			avsRegistrations,
			totalStakers: operator.totalStakers,
			totalAvs: operator.totalAvs,
			tvl: withTvl
				? sharesToTVL(
						operator.shares,
						strategiesWithSharesUnderlying,
						strategyTokenPrices
				  )
				: undefined,
			rewards: withRewards ? await calculateOperatorApy(operator) : undefined,
			stakers: undefined,
			metadataUrl: undefined,
			isMetadataSynced: undefined,
			avs: undefined,
			tvlEth: undefined,
			sharesHash: undefined
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /operators/addresses
 * Returns a list of all Operators, addresses & logos. Optionally perform a text search for a list of matched Operators.
 *
 * @param req
 * @param res
 */
export async function getAllOperatorAddresses(req: Request, res: Response) {
	// Validate pagination query
	const result = PaginationQuerySchema.and(SearchByTextQuerySchema).safeParse(
		req.query
	)
	if (!result.success) {
		return handleAndReturnErrorResponse(req, res, result.error)
	}

	try {
		const { skip, take, searchByText, searchMode } = result.data
		const searchFilterQuery = getOperatorSearchQuery(
			searchByText,
			searchMode,
			'full'
		)

		// Fetch records
		const operatorRecords = await prisma.operator.findMany({
			select: {
				address: true,
				metadataName: true,
				metadataLogo: true
			},
			where: {
				...searchFilterQuery
			},
			...(searchByText && {
				orderBy: {
					tvlEth: 'desc'
				}
			}),
			skip,
			take
		})

		// Determine count
		const operatorCount = await prisma.operator.count({
			where: {
				...searchFilterQuery
			}
		})

		const data = operatorRecords.map((operator) => ({
			address: operator.address,
			name: operator.metadataName,
			logo: operator.metadataLogo
		}))

		// Send response with data and metadata
		res.send({
			data,
			meta: {
				total: operatorCount,
				skip,
				take
			}
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /operators/:address/rewards
 * Returns a list of strategies that the Operator is rewarded for, and the tokens they're rewarded in
 *
 * @param req
 * @param res
 * @returns
 */
export async function getOperatorRewards(req: Request, res: Response) {
	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { address } = req.params

		// Fetch Operator data
		const operator = await prisma.operator.findUnique({
			where: { address: address.toLowerCase() },
			include: {
				avs: {
					include: {
						avs: {
							include: {
								rewardSubmissions: true
							}
						}
					}
				},
				shares: true
			}
		})

		if (!operator) {
			throw new Error('Operator not found.')
		}

		const result: {
			address: string
			rewardTokens: Set<string>
			rewardStrategies: Set<string>
		} = {
			address,
			rewardTokens: new Set<string>(),
			rewardStrategies: new Set<string>()
		}

		// Create a Set of strategies where the operator has positive TVL
		const operatorActiveStrategies = new Set(
			operator.shares
				.filter((share) => new Prisma.Prisma.Decimal(share.shares).gt(0))
				.map((share) => share.strategyAddress.toLowerCase())
		)

		// Iterate through all Avs
		for (const avsOperator of operator.avs) {
			const avs = avsOperator.avs

			// Iterate through all reward submissions
			for (const submission of avs.rewardSubmissions) {
				result.rewardTokens.add(submission.token.toLowerCase())

				if (
					operatorActiveStrategies.has(submission.strategyAddress.toLowerCase())
				) {
					result.rewardStrategies.add(
						submission.strategyAddress.toLowerCase()
					)
				}
			}
		}

		res.send({
			address: result.address,
			rewardTokens: Array.from(result.rewardTokens),
			rewardStrategies: Array.from(result.rewardStrategies)
		})
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

/**
 * Function for route /operators/:address/invalidate-metadata
 * Protected route to invalidate the metadata of a given Operator
 *
 * @param req
 * @param res
 */
export async function invalidateMetadata(req: Request, res: Response) {
	const paramCheck = EthereumAddressSchema.safeParse(req.params.address)
	if (!paramCheck.success) {
		return handleAndReturnErrorResponse(req, res, paramCheck.error)
	}

	try {
		const { address } = req.params

		const updateResult = await prisma.operator.updateMany({
			where: { address: address.toLowerCase() },
			data: { isMetadataSynced: false }
		})

		if (updateResult.count === 0) {
			throw new Error('Address not found.')
		}

		res.send({ message: 'Metadata invalidated successfully.' })
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}

// --- Helper functions ---

export function getOperatorSearchQuery(
	searchByText: string | undefined,
	searchMode: 'contains' | 'startsWith',
	searchScope: 'partial' | 'full'
) {
	if (!searchByText) return {}

	const searchConfig = { [searchMode]: searchByText, mode: 'insensitive' }

	if (searchScope === 'partial') {
		return {
			OR: [
				{ address: searchConfig },
				{ metadataName: searchConfig }
			] as Prisma.Prisma.OperatorWhereInput[]
		}
	}

	return {
		OR: [
			{ address: searchConfig },
			{ metadataName: searchConfig },
			{ metadataDescription: searchConfig },
			{ metadataWebsite: searchConfig }
		] as Prisma.Prisma.OperatorWhereInput[]
	}
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
async function calculateOperatorApy(operator: any) {
	try {
		const avsRewardsMap: Map<string, number> = new Map()
		const strategyRewardsMap: Map<string, number> = new Map()

		// Grab the all reward submissions that the Operator is eligible for basis opted strategies & AVSs
		const optedStrategyAddresses: Set<string> = new Set(
			operator?.shares.map((share) => share.strategyAddress.toLowerCase())
		)
		const avsWithEligibleRewardSubmissions = operator?.avs
			.filter((avsOp) => avsOp.avs.rewardSubmissions.length > 0)
			.map((avsOp) => ({
				avs: avsOp.avs,
				eligibleRewards: avsOp.avs.rewardSubmissions.filter((reward) =>
					optedStrategyAddresses.has(reward.strategyAddress.toLowerCase())
				)
			}))
			.filter((item) => item.eligibleRewards.length > 0)

		if (!avsWithEligibleRewardSubmissions) {
			return {
				avs: [],
				strategies: [],
				aggregateApy: 0,
				operatorEarningsEth: 0
			}
		}

		let operatorEarningsEth = new Prisma.Prisma.Decimal(0)

		const strategyTokenPrices = await fetchStrategyTokenPrices()
		const rewardTokenPrices = await fetchRewardTokenPrices()
		const eigenContracts = getEigenContracts()
		const tokenToStrategyMap = tokenToStrategyAddressMap(
			eigenContracts.Strategies
		)

		const strategiesWithSharesUnderlying =
			await getStrategiesWithShareUnderlying()

		// Calc aggregate APY for each AVS basis the opted-in strategies
		for (const avs of avsWithEligibleRewardSubmissions) {
			let aggregateApy = 0

			// Get share amounts for each restakeable strategy
			const shares = withOperatorShares(avs.avs.operators).filter(
				(s) =>
					avs.avs.restakeableStrategies.indexOf(
						s.strategyAddress.toLowerCase()
					) !== -1
			)

			// Fetch the AVS tvl for each strategy
			const tvlStrategiesEth = sharesToTVLEth(
				shares,
				strategiesWithSharesUnderlying,
				strategyTokenPrices
			)

			// Iterate through each strategy and calculate all its rewards
			for (const strategyAddress of optedStrategyAddresses) {
				const strategyTvl = tvlStrategiesEth[strategyAddress.toLowerCase()] || 0
				if (strategyTvl === 0) continue

				let totalRewardsEth = new Prisma.Prisma.Decimal(0)
				let totalDuration = 0

				// Find all reward submissions attributable to the strategy
				const relevantSubmissions = avs.eligibleRewards.filter(
					(submission) =>
						submission.strategyAddress.toLowerCase() ===
						strategyAddress.toLowerCase()
				)

				for (const submission of relevantSubmissions) {
					let rewardIncrementEth = new Prisma.Prisma.Decimal(0)
					const rewardTokenAddress = submission.token.toLowerCase()
					const tokenStrategyAddress =
						tokenToStrategyMap.get(rewardTokenAddress)

					// Normalize reward amount to its ETH price
					if (tokenStrategyAddress) {
						const tokenPrice = Object.values(strategyTokenPrices).find(
							(tp) => tp.strategyAddress.toLowerCase() === tokenStrategyAddress
						)
						rewardIncrementEth = submission.amount.mul(
							new Prisma.Prisma.Decimal(tokenPrice?.eth ?? 0)
						)
					} else {
						// Check if it is a reward token which isn't a strategy on EL
						for (const [, price] of Object.entries(rewardTokenPrices)) {
							if (
								price &&
								price.tokenAddress.toLowerCase() === rewardTokenAddress
							) {
								rewardIncrementEth = submission.amount.mul(
									new Prisma.Prisma.Decimal(price.eth ?? 0)
								)
							} else {
								// Check for special tokens
								rewardIncrementEth = isSpecialToken(rewardTokenAddress)
									? submission.amount
									: new Prisma.Prisma.Decimal(0)
							}
						}
					}

					// Multiply reward amount in ETH by the strategy weight
					rewardIncrementEth = rewardIncrementEth
						.mul(submission.multiplier)
						.div(new Prisma.Prisma.Decimal(10).pow(18))

					// Operator takes 10% in commission
					const operatorFeesEth = rewardIncrementEth.mul(10).div(100)
					operatorEarningsEth = operatorEarningsEth.add(operatorFeesEth)

					totalRewardsEth = totalRewardsEth
						.add(rewardIncrementEth)
						.sub(operatorFeesEth)
					totalDuration += submission.duration
				}

				if (totalDuration === 0) continue

				// Annualize the reward basis its duration to find yearly APY
				const rewardRate =
					totalRewardsEth
						.div(new Prisma.Prisma.Decimal(10).pow(18))
						.toNumber() / strategyTvl
				const annualizedRate =
					rewardRate * ((365 * 24 * 60 * 60) / totalDuration)
				const apy = annualizedRate * 100
				aggregateApy += apy

				// Add strategy's APY to common strategy rewards store (across all Avs)
				const currentStrategyApy = strategyRewardsMap.get(strategyAddress) || 0
				strategyRewardsMap.set(strategyAddress, currentStrategyApy + apy)
			}
			// Add aggregate APY to Avs rewards store
			avsRewardsMap.set(avs.avs.address, aggregateApy)
		}

		const response = {
			avs: Array.from(avsRewardsMap, ([avsAddress, apy]) => ({
				avsAddress,
				apy
			})),
			strategies: Array.from(strategyRewardsMap, ([strategyAddress, apy]) => ({
				strategyAddress,
				apy
			})),
			aggregateApy: 0,
			operatorEarningsEth: new Prisma.Prisma.Decimal(0)
		}

		// Calculate aggregates across Avs and strategies
		response.aggregateApy = response.avs.reduce((sum, avs) => sum + avs.apy, 0)
		response.operatorEarningsEth = operatorEarningsEth

		return response
	} catch {}
}

/**
 * Return a map of strategy addresses <> token addresses
 *
 * @param strategies
 * @returns
 */
export function tokenToStrategyAddressMap(
	strategies: EigenStrategiesContractAddress
): Map<string, string> {
	const map = new Map<string, string>()
	for (const [key, value] of Object.entries(strategies)) {
		if (key !== 'Eigen' && value?.tokenContract && value?.strategyContract) {
			map.set(
				value.tokenContract.toLowerCase(),
				value.strategyContract.toLowerCase()
			)
		}
	}
	return map
}

/**
 * Returns whether a given token address belongs to a list of special tokens
 *
 * @param tokenAddress
 * @returns
 */
export function isSpecialToken(tokenAddress: string): boolean {
	const specialTokens =
		getNetwork() === holesky
			? [
					'0x6Cc9397c3B38739daCbfaA68EaD5F5D77Ba5F455', // WETH
					'0xbeac0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeebeac0'
			  ]
			: [
					'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
					'0xbeac0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeebeac0'
			  ]

	return specialTokens.includes(tokenAddress.toLowerCase())
}
