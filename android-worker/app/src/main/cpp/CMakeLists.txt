cmake_minimum_required(VERSION 3.22)
project(rpc_server_jni LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# Pin llama.cpp to a specific stable release tag for reproducible builds
FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG        b4568
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
)

# Configure llama.cpp build options — disable everything except RPC
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(llama_cpp)

# Build the JNI shared library wrapping rpc-server functionality
add_library(rpc_server_jni SHARED rpc_server_wrapper.cpp)

target_include_directories(rpc_server_jni PRIVATE
    ${llama_cpp_SOURCE_DIR}/include
    ${llama_cpp_SOURCE_DIR}/ggml/include
    ${llama_cpp_SOURCE_DIR}/examples/rpc
    ${llama_cpp_SOURCE_DIR}/common
)

target_link_libraries(rpc_server_jni PRIVATE
    ggml
    log
    android
)

target_compile_definitions(rpc_server_jni PRIVATE
    GGML_USE_RPC
)
