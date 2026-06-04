function getFirst<T extends string>(arr: T[]): T {
  return arr[0]
}

const arr = [1, 2, 3]
const first = getFirst(arr)
console.log(first)
