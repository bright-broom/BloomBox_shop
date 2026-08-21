import {
  formatPostalCode,
  postalCode,
  type PostalAddress,
  type PostalAddressRepository,
} from "../domain/postal-address";

export type PostalCodeLookupResult = Readonly<{
  postalCode: string;
  addresses: readonly PostalAddress[];
}>;

export class LookupPostalCode {
  constructor(private readonly addresses: PostalAddressRepository) {}

  async execute(input: string): Promise<PostalCodeLookupResult> {
    const normalized = postalCode(input);
    return {
      postalCode: formatPostalCode(normalized),
      addresses: await this.addresses.findByPostalCode(normalized),
    };
  }
}
