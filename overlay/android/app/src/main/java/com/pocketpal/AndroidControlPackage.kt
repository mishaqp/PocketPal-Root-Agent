package com.pocketpal

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AndroidControlPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == AndroidControlModule.NAME) AndroidControlModule(reactContext) else null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        AndroidControlModule.NAME to ReactModuleInfo(
          AndroidControlModule.NAME,
          AndroidControlModule.NAME,
          false,
          false,
          true,
          false,
          false
        )
      )
    }
  }
}
