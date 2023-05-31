import { BigNumber, BigNumberish, BytesLike, Contract, ethers } from "ethers";
import { UserOperationBuilder } from "../../../builder";
import {
  estimateUserOperationGas,
  getGasPrice,
} from "../../middleware";
import {
  EntryPoint,
  EntryPoint__factory,
  KernelFactory,
  KernelFactory__factory,
  Kernel,
  Kernel__factory,
} from "../../../typechain";
import { UserOperationMiddlewareFn } from "../../../types";
import { DEFAULT_MULTISEND_ADDRESS, DUMMY_SIGNATURE, ENTRYPOINT_ADDRESS, KERNEL_FACTORY_ADDRESS } from "./constants";
import { encodeMultiSend } from "./utilities/encodeMultiSend";

export interface KernelAccountOptions {
  address: string,
  provider: ethers.providers.JsonRpcProvider,
  entryPoint?: string,
  factoryAddress?: string,
  multiSendAddress?: string
}

export interface KernelAccountInitOptions extends KernelAccountOptions {
    index?: number,
    paymasterMiddleware?: UserOperationMiddlewareFn,
}

export class KernelAccount extends UserOperationBuilder {
  protected address: string;
  protected provider: ethers.providers.JsonRpcProvider;
  public entryPoint: EntryPoint;
  protected factory: KernelFactory;
  protected initCode: string;
  protected multiSendAddress: string;
  proxy: Kernel;

  protected constructor({
    address,
    provider,
    entryPoint = ENTRYPOINT_ADDRESS,
    factoryAddress = KERNEL_FACTORY_ADDRESS,
    multiSendAddress = DEFAULT_MULTISEND_ADDRESS
  }: KernelAccountOptions) {
    super();
    this.address = address
    this.provider = provider;
    this.entryPoint = EntryPoint__factory.connect(entryPoint, this.provider);
    this.factory = KernelFactory__factory.connect(
      factoryAddress,
      this.provider
    );
    this.initCode = "0x";
    this.proxy = Kernel__factory.connect(
      ethers.constants.AddressZero,
      this.provider
    );
    this.multiSendAddress = multiSendAddress
  }

  private resolveAccount: UserOperationMiddlewareFn = async (ctx) => {
    const senderAddressCode = await this.provider.getCode(this.proxy.address)
    const isDeployed = senderAddressCode.length > 2
    let nonce = BigNumber.from(0)
    if (isDeployed) nonce = await this.proxy["getNonce()"]()
    ctx.op.nonce = nonce 
    ctx.op.initCode = ctx.op.nonce.eq(0) ? this.initCode : "0x";
  };

  public static async init({index = 0, paymasterMiddleware, ...options}: KernelAccountInitOptions): Promise<KernelAccount> {
    const instance = new KernelAccount(options);

    try {
      instance.initCode = ethers.utils.hexConcat([
        instance.factory.address,
        instance.factory.interface.encodeFunctionData("createAccount", [
          instance.address,
          index
        ]),
      ]);
      await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);

      throw new Error("getSenderAddress: unexpected result");
    } catch (error: any) {
      const addr = error?.errorArgs?.sender;
      if (!addr) throw error;

      instance.proxy = Kernel__factory.connect(addr, instance.provider);
    }

    const base = instance
      .useDefaults({
        sender: instance.proxy.address,
        signature: DUMMY_SIGNATURE,
      })
      .useMiddleware(instance.resolveAccount)
      .useMiddleware(getGasPrice(instance.provider));

    const withPM = paymasterMiddleware
      ? base.useMiddleware(paymasterMiddleware)
      : base.useMiddleware(estimateUserOperationGas(instance.provider));

    return withPM
  }

  execute(to: string, value: BigNumberish, data: BytesLike) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("executeAndRevert", [to, value, data, 0])
    );
  }

  executeDelegate(to: string, value: BigNumberish, data: BytesLike) {
    return this.setCallData(
      this.proxy.interface.encodeFunctionData("executeAndRevert", [to, value, data, 1])
    );
  }

  executeBatch(to: Array<string>, data: Array<BytesLike>, delegateCall: Array<boolean>) {
    const numberOfCalls = to.length
    if (numberOfCalls !== data.length || numberOfCalls !== delegateCall.length) {
      // TODO
      throw Error("Wrong length")
    }
    const multiSend = new Contract(this.multiSendAddress, [
      'function multiSend(bytes memory transactions)',
    ])

    const calls = to.map((item, i) => ({
      to: item,
      data: data[i],
      delegateCall: delegateCall[i]
    }))

    const multiSendCalldata = multiSend.interface.encodeFunctionData(
      'multiSend',
      [encodeMultiSend(calls)]
    )
    return this.executeDelegate(multiSend.address, 0, multiSendCalldata)
  }
}
