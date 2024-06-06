import prisma from '@prisma/client'
import { parseAbiItem } from 'viem'
import { getEigenContracts } from '../data/address'
import { getViemClient } from '../utils/viemClient'
import {
	bulkUpdateDbTransactions,
	fetchLastSyncBlock,
	getBlockDataFromDb,
	loopThroughBlocks
} from '../utils/seeder'
import { getPrismaClient } from '../utils/prismaClient'

const blockSyncKeyLogs = 'lastSyncedBlock_logs_operatorShares'

/**
 * Utility function to seed event logs
 *
 * @param fromBlock
 * @param toBlock
 */
export async function seedLogsOperatorShares(toBlock?: bigint, fromBlock?: bigint) {
	console.log('Seeding Event Logs for OperatorSharesIncreased and OperatorSharesDecreased...')

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const dbTransactions: any[] = []

	const viemClient = getViemClient()
	const prismaClient = getPrismaClient()

	const logsOperatorSharesIncreased: prisma.EventLogs_OperatorSharesIncreased[] = []
    const logsOperatorSharesDecreased: prisma.EventLogs_OperatorSharesDecreased[] = []

	const firstBlock = fromBlock
		? fromBlock
		: await fetchLastSyncBlock(blockSyncKeyLogs)
	const lastBlock = toBlock ? toBlock : await viemClient.getBlockNumber()
	const blockData = await getBlockDataFromDb(firstBlock, lastBlock)

	// Loop through evm logs
	await loopThroughBlocks(firstBlock, lastBlock, async (fromBlock, toBlock) => {
		try {
			const logs = await viemClient.getLogs({
				address: [
					getEigenContracts().DelegationManager
				],
				events: [
					parseAbiItem(
						'event OperatorSharesIncreased(address indexed operator, address staker, address strategy, uint256 shares)'
					),
					parseAbiItem(
						'event OperatorSharesDecreased(address indexed operator, address staker, address strategy, uint256 shares)'
					),
				],
				fromBlock,
				toBlock
			})

			// Setup a list containing event data
			for (const l in logs) {
				const log = logs[l]

                logsOperatorSharesIncreased.push({
                    address: log.address,
					transactionHash: log.transactionHash,
					transactionIndex: log.transactionIndex,
					blockNumber: BigInt(log.blockNumber),
					blockHash: log.blockHash,
					blockTime: blockData.get(log.blockNumber) || new Date(0),
                    operator: String(log.args.operator),
                    staker: String(log.args.staker),
                    strategy: String(log.args.strategy),
                    shares: String(log.args.shares)
                })

                logsOperatorSharesDecreased.push({
                    address: log.address,
					transactionHash: log.transactionHash,
					transactionIndex: log.transactionIndex,
					blockNumber: BigInt(log.blockNumber),
					blockHash: log.blockHash,
					blockTime: blockData.get(log.blockNumber) || new Date(0),
                    operator: String(log.args.operator),
                    staker: String(log.args.staker),
                    strategy: String(log.args.strategy),
                    shares: String(log.args.shares)
                })
            }

			dbTransactions.push(
				prismaClient.eventLogs_OperatorSharesIncreased.createMany({
					data: logsOperatorSharesIncreased,
					skipDuplicates: true
				})
			)

            dbTransactions.push(
				prismaClient.eventLogs_OperatorSharesDecreased.createMany({
					data: logsOperatorSharesDecreased,
					skipDuplicates: true
				})
			)

			// Store last synced block
			dbTransactions.push(
				prismaClient.settings.upsert({
					where: { key: blockSyncKeyLogs },
					update: { value: Number(toBlock) },
					create: { key: blockSyncKeyLogs, value: Number(toBlock) }
				})
			)

			// Update database
			await bulkUpdateDbTransactions(dbTransactions)
		} catch (error) {}
	})

	console.log(
		`Seeded OperatorSharesIncreased logs between blocks ${firstBlock} ${lastBlock}: ${logsOperatorSharesIncreased.length}`
	)
	console.log(
		`Seeded OperatorSharesDecreased logs between blocks ${firstBlock} ${lastBlock}: ${logsOperatorSharesDecreased.length}`
	)
}