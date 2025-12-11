import EventEmitter from 'node:events'

/**
 * Convenience class to track progress of multiple parts with different weights.
 * Usage:
 *
 * const progress = new ProgressParts()
 * const part1 = progress.addPart(1)
 * const part2 = progress.addPart(10)
 * const part3 = progress.addPart(1)
 * // Total weight is 12
 * part1(0.5) // part 1 is 50% done
 * console.log(progress.progress()) // 4.16% done
 *
 */
export class ProgressParts extends EventEmitter {
	private parts: { progress: number; weight: number }[] = []

	destroy(): void {
		this.removeAllListeners()
		this.parts = []
	}

	addPart(weight = 1): ProgressPart {
		const part = { progress: 0, weight }
		this.parts.push(part)
		return (progress: number): void => {
			part.progress = Math.min(1, Math.max(0, progress))

			this.emit('progress', this.progress())
		}
	}
	/** Returns total progress 0 - 1.0 */
	progress(): number {
		const totalWeight = this.parts.reduce((sum, part) => sum + part.weight, 0)
		if (totalWeight === 0) return 0

		const totalWeightedProgress = this.parts.reduce((sum, part) => sum + part.progress * part.weight, 0)

		return totalWeightedProgress / totalWeight
	}
}
export type ProgressPart = (progress: number) => void
