#!/usr/bin/env bash

set -eox pipefail

curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH":"$HOME/.maestro/bin"

# install dcd
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 22
npm install -g @devicecloud.dev/dcd

if [ "$EAS_BUILD_PLATFORM" = "ios" ]
then
  brew install java
  echo 'export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"' >> ~/.zshrc
  sudo ln -sfn /opt/homebrew/opt/openjdk/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk
  export CPPFLAGS="-I/opt/homebrew/opt/openjdk/include"

  APP_EXECUTABLE_PATH=/Users/expo/workingdir/build/ios/build/Build/Products/Release-iphonesimulator/Sovran.app

  MAESTRO_API_KEY=$MAESTRO_API_KEY
  dcd cloud --apiKey $MAESTRO_API_KEY $APP_EXECUTABLE_PATH .maestro  
else
  APP_EXECUTABLE_PATH=/home/expo/workingdir/build/android/app/build/outputs/apk/release/app-release.apk
fi
