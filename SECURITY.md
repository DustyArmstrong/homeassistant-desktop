# Security Policy

This is the security policy for Home Assistant Desktop.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.7.x   | :white_check_mark: |
| 1.6.x   | :x:                |

## Project Builds

All releases produced by myself will be signed and verified by my user account. Each build reflects the precise code on the master branch at the time it is built. This repository is enabled with vigilant mode - always look out for the green tick!

All builds will be produced with a SHA256 sum alongside, these should always match those produced by GitHub on upload. 

You may verify the accuracy of the SHA256 sum at any time by cloning the repository from the relevant commit, installing the dependencies and building the relevant binary.

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Home Assistant Desktop, please report it through the following mechanisms. 

| Estimated CVSSv3 | Threat Landscape | How to Report |
| :--- | :--- | :--- |
| **7.0+** | The vulnerability is **actively being exploited** out in the wild. | Email directly: `dusty@dustcloud.dev` |
| **7.0+** | The vulnerability is **theoretical** (no evidence of exploits being used). | Go to the **Security** tab above and click **"Report a vulnerability"** |
| **Under 7.0** | Medium or Low severity bugs or issues. | Open a standard **GitHub Issue** |

These mechanisms have been selected to reduce any potential issues with a major public disclosure before a patch can be issued ('zero day'). This is unlikely given the nature of this repository, but all the same.

