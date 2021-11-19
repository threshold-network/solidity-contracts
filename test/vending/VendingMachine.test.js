const { expect } = require("chai")

const { helpers } = require("hardhat")
const { to1e18, to1ePrecision } = helpers.number

describe("VendingMachine", () => {
  let wrappedToken
  let tToken

  const floatingPointDivisor = to1ePrecision(1, 15)
  const tAllocation = to1e18("4500000000") // 4.5 Billion
  const maxWrappedTokens = to1e18("1100000000") // 1.1 Billion
  const expectedRatio = floatingPointDivisor
    .mul(tAllocation)
    .div(maxWrappedTokens)

  function convertToT(amount) {
    amount = ethers.BigNumber.from(amount)
    const wrappedRemainder = amount.mod(floatingPointDivisor)
    amount = amount.sub(wrappedRemainder)
    return {
      result: amount.mul(expectedRatio).div(floatingPointDivisor),
      remainder: wrappedRemainder,
    }
  }

  function convertFromT(amount) {
    amount = ethers.BigNumber.from(amount)
    const tRemainder = amount.mod(expectedRatio)
    amount = amount.sub(tRemainder)
    return {
      result: amount.mul(floatingPointDivisor).div(expectedRatio),
      remainder: tRemainder,
    }
  }

  let vendingMachine

  // Token holder has 5 wrapped tokens (KEEP/NU)
  let tokenHolder
  const initialHolderBalance = to1e18(5)

  // Third party has no wrapped tokens and no T tokens.
  let thirdParty

  beforeEach(async () => {
    const TestToken = await ethers.getContractFactory("TestToken")
    wrappedToken = await TestToken.deploy()
    await wrappedToken.deployed()

    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    let auxiliaryAccount
    ;[tokenHolder, thirdParty, auxiliaryAccount] = await ethers.getSigners()
    await tToken.mint(auxiliaryAccount.address, tAllocation)
    await wrappedToken.mint(auxiliaryAccount.address, maxWrappedTokens)

    const VendingMachine = await ethers.getContractFactory("VendingMachine")
    vendingMachine = await VendingMachine.deploy(
      wrappedToken.address,
      tToken.address,
      maxWrappedTokens,
      tAllocation
    )
    await vendingMachine.deployed()
    await tToken
      .connect(auxiliaryAccount)
      .transfer(vendingMachine.address, tAllocation)
    await wrappedToken
      .connect(auxiliaryAccount)
      .transfer(tokenHolder.address, initialHolderBalance)
  })

  describe("setup", () => {
    context("once deployed", () => {
      it("token contract addresses should be correct", async () => {
        expect(await vendingMachine.tToken()).to.equal(tToken.address)
        expect(await vendingMachine.wrappedToken()).to.equal(
          wrappedToken.address
        )
      })
      it("conversion ratio was computed correctly", async () => {
        expect(await vendingMachine.ratio()).to.equal(expectedRatio)
      })
    })
  })

  describe("wrap", () => {
    context("when caller has no wrapped tokens", () => {
      it("should revert", async () => {
        const amount = to1e18(1)
        await wrappedToken
          .connect(thirdParty)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(thirdParty).wrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
    })

    context("when tokenholder has not enough wrapped tokens", () => {
      it("should revert", async () => {
        const amount = initialHolderBalance.add(to1e18(1))
        await wrappedToken
          .connect(tokenHolder)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(tokenHolder).wrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
    })

    context("when conversion amount results in 0 tokens", () => {
      it("should revert", async () => {
        const amount = 1
        await wrappedToken
          .connect(tokenHolder)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(tokenHolder).wrap(amount)
        ).to.be.revertedWith("Disallow conversions of zero value")
      })
    })

    context("when token holder has enough wrapped tokens", () => {
      context("when wrapping entire allowance", () => {
        const amount = initialHolderBalance
        const expectedNewBalance = convertToT(amount).result
        const expectedRemaining = tAllocation.sub(expectedNewBalance)
        let tx

        beforeEach(async () => {
          await wrappedToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, amount)
          tx = await vendingMachine.connect(tokenHolder).wrap(amount)
        })

        it("should transfer wrapped tokens to Vending Machine", async () => {
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            amount
          )
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(0)
        })

        it("should transfer T tokens to token holder", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            expectedNewBalance
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            expectedRemaining
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, expectedNewBalance)
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(amount)
        })
      })

      context("when wrapping part of the allowance", () => {
        const amount = to1e18(1)
        const expectedNewBalance = convertToT(amount).result
        const expectedRemaining = tAllocation.sub(expectedNewBalance)
        let tx

        beforeEach(async () => {
          await wrappedToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, initialHolderBalance)
          tx = await vendingMachine.connect(tokenHolder).wrap(amount)
        })

        it("should transfer wrapped tokens to Vending Machine", async () => {
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            amount
          )
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            initialHolderBalance.sub(amount)
          )
        })

        it("should transfer T tokens to token holder", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            expectedNewBalance
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            expectedRemaining
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, expectedNewBalance)
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(amount)
        })
      })

      context(
        "when wrapping an amount that isn't exact for the conversion ratio",
        () => {
          const convertibleAmount = to1e18(1)
          const amount = convertibleAmount.add(1)
          const expectedNewBalance = convertToT(amount).result
          const expectedRemaining = tAllocation.sub(expectedNewBalance)
          let tx

          beforeEach(async () => {
            await wrappedToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, initialHolderBalance)
            tx = await vendingMachine.connect(tokenHolder).wrap(amount)
          })

          it("should transfer wrapped tokens to Vending Machine", async () => {
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(convertibleAmount)
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              initialHolderBalance.sub(convertibleAmount)
            )
          })

          it("should transfer T tokens to token holder", async () => {
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              expectedNewBalance
            )
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              expectedRemaining
            )
          })

          it("should emit Wrapped event", async () => {
            await expect(tx)
              .to.emit(vendingMachine, "Wrapped")
              .withArgs(
                tokenHolder.address,
                convertibleAmount,
                expectedNewBalance
              )
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal(convertibleAmount)
          })
        }
      )
    })
  })

  describe("receiveApproval", () => {
    context("when called directly", () => {
      it("should revert", async () => {
        await expect(
          vendingMachine
            .connect(tokenHolder)
            .receiveApproval(
              tokenHolder.address,
              initialHolderBalance,
              wrappedToken.address,
              []
            )
        ).to.be.revertedWith("Only wrapped token caller allowed")
      })
    })

    context("when called not for the wrapped token", () => {
      it("should revert", async () => {
        await expect(
          tToken
            .connect(tokenHolder)
            .approveAndCall(vendingMachine.address, to1e18(1), [])
        ).to.be.revertedWith("Token is not the wrapped token")
      })
    })

    context("when called via wrapped token's approveAndCall", () => {
      const amount = to1e18(2)
      const expectedNewBalance = convertToT(amount).result
      const expectedRemaining = tAllocation.sub(expectedNewBalance)
      let tx

      beforeEach(async () => {
        tx = await wrappedToken
          .connect(tokenHolder)
          .approveAndCall(vendingMachine.address, amount, [])
      })

      it("should transfer wrapped tokens to Vending Machine", async () => {
        expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
          amount
        )
        expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
          initialHolderBalance.sub(amount)
        )
      })

      it("should transfer T tokens to token holder", async () => {
        expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
          expectedNewBalance
        )
        expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
          expectedRemaining
        )
      })

      it("should emit Wrapped event", async () => {
        await expect(tx)
          .to.emit(vendingMachine, "Wrapped")
          .withArgs(tokenHolder.address, amount, expectedNewBalance)
      })
    })
  })

  describe("unwrap", () => {
    const wrappedAmount = to1e18(3)
    const tAmount = convertToT(wrappedAmount).result

    beforeEach(async () => {
      await wrappedToken
        .connect(tokenHolder)
        .approve(vendingMachine.address, wrappedAmount)
      await vendingMachine.connect(tokenHolder).wrap(wrappedAmount)
    })

    context("when caller has no T tokens", () => {
      it("should revert", async () => {
        const amount = convertToT(to1e18(1)).result
        await tToken.connect(thirdParty).approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(thirdParty).unwrap(amount)
        ).to.be.revertedWith("Can not unwrap more than previously wrapped")
      })
    })

    context("when token holder has not enough T tokens", () => {
      it("should revert", async () => {
        const amount = tAmount.add(to1e18(1))
        await tToken
          .connect(tokenHolder)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(tokenHolder).unwrap(amount)
        ).to.be.revertedWith("Can not unwrap more than previously wrapped")
      })
    })

    context("when token holder has enough T tokens", () => {
      context("when unwrapping more than previously wrapped", () => {
        it("should revert", async () => {
          await tToken.mint(tokenHolder.address, to1e18(1))
          await tToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, tAmount.add(to1e18(1)))
          await expect(
            vendingMachine.connect(tokenHolder).unwrap(tAmount.add(to1e18(1)))
          ).to.be.revertedWith("Can not unwrap more than previously wrapped")
        })
      })

      context("when unwrapping all that was previously wrapped", () => {
        let tx

        beforeEach(async () => {
          await tToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, tAmount)
          tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount)
        })

        it("should transfer T tokens to Vending Machine", async () => {
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            tAllocation
          )
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(0)
        })

        it("should transfer wrapped tokens to token holder", async () => {
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            initialHolderBalance
          )
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            0
          )
        })

        it("should emit Unwrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Unwrapped")
            .withArgs(tokenHolder.address, tAmount, wrappedAmount)
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(0)
        })
      })

      context("when unwrapping part of what was previously wrapped", () => {
        context("when unwrapping entire allowance", () => {
          let tAmount2 = to1e18(2)
          const conversion = convertFromT(tAmount2)
          const wrappedAmount2 = conversion.result
          tAmount2 = tAmount2.sub(conversion.remainder)

          const allocationLeft = tAllocation.sub(tAmount).add(tAmount2)
          const holderTBalance = tAmount.sub(tAmount2)
          let tx

          beforeEach(async () => {
            await tToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, tAmount2)
            tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount2)
          })

          it("should transfer T tokens to Vending Machine", async () => {
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              allocationLeft
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              holderTBalance
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              initialHolderBalance.sub(wrappedAmount).add(wrappedAmount2)
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })

          it("should emit Unwrapped event", async () => {
            await expect(tx)
              .to.emit(vendingMachine, "Unwrapped")
              .withArgs(tokenHolder.address, tAmount2, wrappedAmount2)
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })
        })

        context("when unwrapping part of the allowance", () => {
          let tAmount2 = to1e18(1)
          const conversion = convertFromT(tAmount2)
          const wrappedAmount2 = conversion.result
          tAmount2 = tAmount2.sub(conversion.remainder)

          beforeEach(async () => {
            await tToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, tAmount)
            tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount2)
          })

          it("should transfer T tokens to Vending Machine", async () => {
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              tAllocation.sub(tAmount).add(tAmount2)
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              tAmount.sub(tAmount2)
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              initialHolderBalance.sub(wrappedAmount).add(wrappedAmount2)
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })

          it("should emit Unwrapped event", async () => {
            await expect(tx)
              .to.emit(vendingMachine, "Unwrapped")
              .withArgs(tokenHolder.address, tAmount2, wrappedAmount2)
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })
        })

        context(
          "when unwrapping unexact amounts wrt to the conversion ratio",
          () => {
            const tAmount2 = to1e18(2)
            const conversion = convertFromT(tAmount2)
            const wrappedAmount2 = conversion.result
            const convertibleTAmount2 = tAmount2.sub(conversion.remainder)

            const allocationLeft = tAllocation
              .sub(tAmount)
              .add(convertibleTAmount2)
            const holderTBalance = tAmount.sub(convertibleTAmount2)
            let tx

            beforeEach(async () => {
              await tToken
                .connect(tokenHolder)
                .approve(vendingMachine.address, tAmount2)
              tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount2)
            })

            it("should transfer T tokens to Vending Machine", async () => {
              expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
                allocationLeft
              )
              expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
                holderTBalance
              )
            })

            it("should transfer wrapped tokens to token holder", async () => {
              expect(
                await wrappedToken.balanceOf(tokenHolder.address)
              ).to.equal(
                initialHolderBalance.sub(wrappedAmount).add(wrappedAmount2)
              )
              expect(
                await wrappedToken.balanceOf(vendingMachine.address)
              ).to.equal(wrappedAmount.sub(wrappedAmount2))
            })

            it("should emit Unwrapped event", async () => {
              await expect(tx)
                .to.emit(vendingMachine, "Unwrapped")
                .withArgs(
                  tokenHolder.address,
                  convertibleTAmount2,
                  wrappedAmount2
                )
            })

            it("should update wrapped balance", async () => {
              expect(
                await vendingMachine.wrappedBalance(tokenHolder.address)
              ).to.equal(wrappedAmount.sub(wrappedAmount2))
            })
          }
        )
      })
    })
  })
})
