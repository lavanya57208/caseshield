import { isProduction } from "@/config/env";
import { IdentityProvider } from "@/modules/auth/identity-provider.types";
import { DemoIdentityProvider } from "@/modules/auth/demo-identity.provider";
import { GoogleIdentityPlatformProvider } from "@/modules/auth/identity-platform.provider";

let instance: IdentityProvider | undefined;

export function getIdentityProvider(): IdentityProvider {
  if (!instance) {
    instance = isProduction ? new GoogleIdentityPlatformProvider() : new DemoIdentityProvider();
  }
  return instance;
}
