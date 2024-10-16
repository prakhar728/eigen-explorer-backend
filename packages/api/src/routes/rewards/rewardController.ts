import type { Request, Response } from 'express'
import { handleAndReturnErrorResponse } from '../../schema/errors'
import prisma from '../../utils/prismaClient'

export type Submission = {
	rewardsSubmissionHash: string
	startTimestamp: number
	duration: number
	totalAmount: string
	tokenAddress: string
	strategies: {
		strategyAddress: string
		multiplier: string
		amount: string
	}[]
}

/**
 * Function for route /operators
 * Returns a list of all Operators with optional sorts & text search
 *
 * @param req
 * @param res
 */
export async function getStrategies(req: Request, res: Response) {
	try {
		const allSubmissions = await prisma.avsStrategyRewardSubmission.findMany()
		const strategyTokensMap = new Map<string, Set<string>>()

		for (const submission of allSubmissions) {
			const strategyAddress = submission.strategyAddress.toLowerCase()
			const tokenAddress = submission.token.toLowerCase()

			if (!strategyTokensMap.has(strategyAddress)) {
				strategyTokensMap.set(strategyAddress, new Set<string>())
			}

			strategyTokensMap.get(strategyAddress)?.add(tokenAddress)
		}

		const strategies = Array.from(strategyTokensMap.entries()).map(
			([strategyAddress, tokens]) => ({
				strategyAddress,
				tokens: Array.from(tokens)
			})
		)

		const result = {
			strategies,
			total: strategies.length
		}

		res.send(result)
	} catch (error) {
		handleAndReturnErrorResponse(req, res, error)
	}
}
