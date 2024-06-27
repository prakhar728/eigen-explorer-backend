import { getPrismaClient } from './prismaClient'
import { chunkArray } from './array'

// Fix for broken types
export interface IMap<K, V> extends Map<K, V> {
	get(key: K): V
}

// Base block
export const baseBlock =
	process.env.NETWORK && process.env.NETWORK === 'holesky'
		? 1159609n
		: 17000000n

// Base time
export const baseTime =
	process.env.NETWORK && process.env.NETWORK === 'holesky'
		? 1710684720000
		: 1680911891000

export async function loopThroughBlocks(
	firstBlock: bigint,
	lastBlock: bigint,
	cb: (fromBlock: bigint, toBlock: bigint) => Promise<void>,
	defaultBatchSize?: bigint
) {
	const batchSize = defaultBatchSize ? defaultBatchSize : 4999n
	let currentBlock = firstBlock
	let nextBlock = firstBlock

	while (nextBlock < lastBlock) {
		nextBlock = currentBlock + batchSize
		if (nextBlock >= lastBlock) nextBlock = lastBlock

		await cb(currentBlock, nextBlock)

		currentBlock = nextBlock
	}

	return lastBlock
}

export async function loopThroughDates(
	startDate: Date,
	endDate: Date,
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	cb: (from: Date, to: Date) => Promise<any>,
	frequency: 'hourly' | 'daily' = 'hourly'
) {
	const setToStartOfHour = (date: Date): Date => {
		const hourlyDate = new Date(date)
		hourlyDate.setMinutes(0, 0, 0)
		return hourlyDate
	}

	let currentDate = setToStartOfHour(startDate)
	const adjustedEndDate = setToStartOfHour(endDate)

	const incrementDate = (date: Date): Date => {
		const nextDate = new Date(date)
		if (frequency === 'hourly') {
			nextDate.setHours(nextDate.getHours() + 1)
		} else if (frequency === 'daily') {
			nextDate.setDate(nextDate.getDate() + 1)
		}
		return nextDate
	}

	while (currentDate <= adjustedEndDate) {
		const nextDate = incrementDate(currentDate)
		await cb(new Date(currentDate), new Date(nextDate))
		currentDate = nextDate
	}
}

export async function bulkUpdateDbTransactions(
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	dbTransactions: any[],
	label?: string
) {
	const prismaClient = getPrismaClient()
	const chunkSize = 1000

	let i = 0
	console.time(`[DB Write (${dbTransactions.length})] ${label || ''}`)

	for (const chunk of chunkArray(dbTransactions, chunkSize)) {
		await prismaClient.$transaction(chunk)

		i++
	}

	console.timeEnd(`[DB Write (${dbTransactions.length})] ${label || ''}`)
}

export async function fetchLastSyncBlock(key: string): Promise<bigint> {
	const prismaClient = getPrismaClient()

	const lastSyncedBlockData = await prismaClient.settings.findUnique({
		where: { key }
	})

	return lastSyncedBlockData?.value
		? BigInt(lastSyncedBlockData.value as number)
		: baseBlock
}

export async function fetchLastSyncTime(key: string): Promise<Date | null> {
	const prismaClient = getPrismaClient()

	const lastSyncedTimeData = await prismaClient.settings.findUnique({
		where: { key }
	})

	return lastSyncedTimeData
		? new Date(lastSyncedTimeData.value as number)
		: null
}

export async function saveLastSyncBlock(key: string, blockNumber: bigint) {
	const prismaClient = getPrismaClient()

	await prismaClient.settings.upsert({
		where: { key: key },
		update: { value: Number(blockNumber) },
		create: { key: key, value: Number(blockNumber) }
	})
}

export async function getBlockDataFromDb(fromBlock: bigint, toBlock: bigint) {
	const prismaClient = getPrismaClient()

	const blockData = await prismaClient.evm_BlockData.findMany({
		where: {
			number: {
				gte: BigInt(fromBlock),
				lte: BigInt(toBlock)
			}
		},
		select: {
			number: true,
			timestamp: true
		},
		orderBy: {
			number: 'asc'
		}
	})

	return new Map(blockData.map((block) => [block.number, block.timestamp]))
}

export async function fetchWithTimeout(
	url: string,
	timeout = 5000
): Promise<Response> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeout)

	try {
		const response = await fetch(url, { signal: controller.signal })
		return response
	} catch (error) {
		if (error.name === 'AbortError') {
			throw new Error('Request timed out')
		}
		throw error
	} finally {
		clearTimeout(timeoutId)
	}
}
