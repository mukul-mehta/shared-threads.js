import { DefaultSerializer, JsonSerializable, Serializer } from './serializers'

const registeredSerializer: Serializer<JsonSerializable> = DefaultSerializer

export function deserialize(message: JsonSerializable): any {
  return registeredSerializer.deserialize(message)
}

export function serialize(input: any): JsonSerializable {
  return registeredSerializer.serialize(input)
}
