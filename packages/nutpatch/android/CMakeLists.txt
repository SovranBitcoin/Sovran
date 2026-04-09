project(NitroNutpatch)
cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME NitroNutpatch)
set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 20)

# ---------------------------------------------------------------------------
# secp256k1
# ---------------------------------------------------------------------------
add_library(secp256k1 STATIC
  ../cpp/vendor/secp256k1/src/secp256k1.c
  ../cpp/vendor/secp256k1/src/precomputed_ecmult.c
  ../cpp/vendor/secp256k1/src/precomputed_ecmult_gen.c
)
target_include_directories(secp256k1 PUBLIC
  ../cpp/vendor/secp256k1/include
  ../cpp/vendor/secp256k1/src
  ../cpp/vendor/secp256k1
)
target_compile_definitions(secp256k1 PRIVATE
  SECP256K1_STATIC=1
  ENABLE_MODULE_EXTRAKEYS=1
  ENABLE_MODULE_SCHNORRSIG=1
)

# ---------------------------------------------------------------------------
# Main library
# ---------------------------------------------------------------------------
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  ../cpp/core/HybridCashuCrypto.cpp
  ../cpp/core/crypto.c
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroNutpatch+autolinking.cmake)

target_include_directories(${PACKAGE_NAME} PRIVATE
  src/main/cpp
  ../cpp/core
  ../cpp/vendor/secp256k1/include
)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
  secp256k1
)
